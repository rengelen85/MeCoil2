"""CloudFormation stack for the MeCoil game server.

A single Graviton EC2 instance in a minimal public-subnet VPC, locked down to the
required ports only, with the SSH private key managed in Secrets Manager. The
instance uses AWS's auto-assigned public IP (billed only while running) rather
than an Elastic IP (billed 24/7) — a boot-time script on the instance (see
Ansible) keeps a free DuckDNS hostname pointed at whatever that IP currently is.
Provisioning of the OS is done afterwards by Ansible.
"""
import os

from aws_cdk import (
    CfnOutput,
    CustomResource,
    Duration,
    RemovalPolicy,
    Stack,
)
from aws_cdk import aws_ec2 as ec2
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from aws_cdk import aws_secretsmanager as secretsmanager
from aws_cdk import custom_resources as cr
from constructs import Construct

_HANDLER_DIR = os.path.dirname(__file__)
with open(os.path.join(_HANDLER_DIR, "keypair_lambda.py"), encoding="utf-8") as _f:
    _KEYPAIR_CODE = _f.read()


class MeCoilServerStack(Stack):
    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        *,
        ssh_ip: str | None,
        instance_type: str,
        key_name: str,
        duckdns_subdomain: str | None,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        if not ssh_ip:
            raise ValueError(
                "ssh_ip is required. Set SSH_ALLOWED_IP in infra/aws.env "
                "(your public IP, e.g. `curl -s https://checkip.amazonaws.com`)."
            )

        # ── Network: minimal, cost-free VPC (public subnet only, no NAT gateway) ──
        vpc = ec2.Vpc(
            self,
            "Vpc",
            max_azs=1,
            nat_gateways=0,
            subnet_configuration=[
                ec2.SubnetConfiguration(
                    name="public",
                    subnet_type=ec2.SubnetType.PUBLIC,
                    cidr_mask=26,
                )
            ],
        )

        # ── Firewall: only 80/443 public, 22 from a single source IP ─────────────
        sg = ec2.SecurityGroup(
            self,
            "ServerSg",
            vpc=vpc,
            description="MeCoil server: HTTP/HTTPS public, SSH from one IP only.",
            allow_all_outbound=True,
        )
        sg.add_ingress_rule(
            ec2.Peer.any_ipv4(), ec2.Port.tcp(80), "HTTP (Let's Encrypt ACME + redirect)"
        )
        sg.add_ingress_rule(ec2.Peer.any_ipv4(), ec2.Port.tcp(443), "HTTPS / WSS")
        sg.add_ingress_rule(
            ec2.Peer.ipv4(f"{ssh_ip}/32"), ec2.Port.tcp(22), "SSH from operator IP"
        )
        # Port 3000 is intentionally NOT opened — it stays bound to localhost and is
        # reached only via the on-box Caddy reverse proxy.

        # ── SSH key pair, private key stored in Secrets Manager ──────────────────
        key_secret = secretsmanager.Secret(
            self,
            "SshKeySecret",
            secret_name="mecoil/ssh-private-key",
            description=f"Private SSH key (PEM) for the MeCoil EC2 key pair '{key_name}'.",
            removal_policy=RemovalPolicy.DESTROY,
        )

        keypair_fn = lambda_.Function(
            self,
            "KeyPairFn",
            runtime=lambda_.Runtime.PYTHON_3_12,
            handler="index.handler",
            code=lambda_.Code.from_inline(_KEYPAIR_CODE),
            timeout=Duration.minutes(2),
            log_retention=logs.RetentionDays.ONE_WEEK,
            description="Generates the EC2 SSH key pair and stores the private key in Secrets Manager.",
        )
        keypair_fn.add_to_role_policy(
            iam.PolicyStatement(
                actions=["ec2:CreateKeyPair", "ec2:DeleteKeyPair", "ec2:CreateTags"],
                resources=["*"],
            )
        )
        key_secret.grant_write(keypair_fn)

        keypair_provider = cr.Provider(
            self, "KeyPairProvider", on_event_handler=keypair_fn
        )
        keypair = CustomResource(
            self,
            "KeyPair",
            service_token=keypair_provider.service_token,
            properties={"KeyName": key_name, "SecretArn": key_secret.secret_arn},
        )

        # ── Optional: DuckDNS token, so the instance can keep a free hostname
        # pointed at its own (dynamic) public IP. Only created when configured —
        # the token value itself is set out-of-band via `make aws-set-duckdns-token`
        # (DuckDNS issues it; CDK never sees or stores the value).
        duckdns_secret = None
        if duckdns_subdomain:
            duckdns_secret = secretsmanager.Secret(
                self,
                "DuckDnsTokenSecret",
                secret_name="mecoil/duckdns-token",
                description=(
                    f"DuckDNS API token used to keep {duckdns_subdomain}.duckdns.org "
                    "pointed at this instance's current public IP. Populate the value "
                    "with `make aws-set-duckdns-token TOKEN=...`."
                ),
                removal_policy=RemovalPolicy.DESTROY,
            )

        # ── EC2 instance (Graviton / Amazon Linux 2023) ──────────────────────────
        role = iam.Role(
            self,
            "InstanceRole",
            assumed_by=iam.ServicePrincipal("ec2.amazonaws.com"),
            managed_policies=[
                # Enables AWS Systems Manager Session Manager as an SSH fallback.
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "AmazonSSMManagedInstanceCore"
                )
            ],
        )
        if duckdns_secret:
            duckdns_secret.grant_read(role)

        instance = ec2.Instance(
            self,
            "Server",
            vpc=vpc,
            vpc_subnets=ec2.SubnetSelection(subnet_type=ec2.SubnetType.PUBLIC),
            # Auto-assigned public IP: billed only while the instance is running
            # (unlike an Elastic IP, which is billed 24/7 even when stopped).
            associate_public_ip_address=True,
            instance_type=ec2.InstanceType(instance_type),
            machine_image=ec2.MachineImage.latest_amazon_linux2023(
                cpu_type=ec2.AmazonLinuxCpuType.ARM_64
            ),
            security_group=sg,
            role=role,
            # The key pair is created out-of-band by the custom resource below;
            # reference it by name (an explicit dependency is added afterwards).
            key_pair=ec2.KeyPair.from_key_pair_name(self, "ImportedKeyPair", key_name),
            require_imdsv2=True,
            # An OS-level shutdown (scheduled at +4h by Ansible) STOPS the instance
            # rather than terminating it — EBS (and thus Caddy's cert cache) persists
            # for a fast restart; the public IP is released and reassigned on start.
            instance_initiated_shutdown_behavior=ec2.InstanceInitiatedShutdownBehavior.STOP,
            block_devices=[
                ec2.BlockDevice(
                    device_name="/dev/xvda",
                    volume=ec2.BlockDeviceVolume.ebs(
                        10, volume_type=ec2.EbsDeviceVolumeType.GP3, encrypted=True
                    ),
                )
            ],
        )
        # The key pair must exist before the instance references it.
        instance.node.add_dependency(keypair)

        # ── Outputs (consumed by the Make targets) ───────────────────────────────
        # No PublicIp output: the address changes on every start, so a CFN output
        # would go stale. `make aws-status` / `make ssh` look it up live instead.
        CfnOutput(self, "InstanceId", value=instance.instance_id)
        CfnOutput(self, "SecretName", value=key_secret.secret_name)
        CfnOutput(self, "KeyName", value=key_name)
        CfnOutput(self, "Region", value=self.region)
        if duckdns_secret:
            CfnOutput(self, "DuckDnsSecretName", value=duckdns_secret.secret_name)
            CfnOutput(self, "Hostname", value=f"{duckdns_subdomain}.duckdns.org")
