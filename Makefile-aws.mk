# ── AWS deployment ──────────────────────────────────────────────────────────
#
# Stands up / manages the cloud game server (CDK + Ansible). See infra/README.md.
#
# AWS credentials are read from your ENVIRONMENT (export them from the AWS
# console). Non-secret config lives in infra/aws.env (copy from aws.env.example).
# Nothing secret is stored in the repo.

.PHONY: aws-prereqs aws-bootstrap aws-deploy aws-provision aws-up ssh \
        aws-start aws-stop aws-status aws-key aws-destroy aws-synth aws-config

REPO_ROOT   := $(CURDIR)
CDK_DIR     := $(REPO_ROOT)/infra/cdk
ANSIBLE_DIR := $(REPO_ROOT)/infra/ansible
AWS_ENV     := $(REPO_ROOT)/infra/aws.env
STACK       := MeCoilServerStack
KEY_NAME    := mecoil-server-key
KEY_PATH    := $(REPO_ROOT)/infra/.ssh/mecoil.pem
VENV_PY     := $(CDK_DIR)/.venv/bin/python

# Load non-secret config (AWS_REGION, SSH_ALLOWED_IP, INSTANCE_TYPE, DOMAIN_NAME, HOSTED_ZONE).
-include $(AWS_ENV)
export

INSTANCE_TYPE ?= t4g.micro

# CDK context passed to the stack.
CDK_CTX := -c ssh_ip=$(SSH_ALLOWED_IP) -c instance_type=$(INSTANCE_TYPE) \
           -c key_name=$(KEY_NAME) -c region=$(AWS_REGION) \
           -c domain=$(DOMAIN_NAME) -c hosted_zone=$(HOSTED_ZONE)

# Run the CDK CLI (npx) with the project's Python venv first on PATH so that
# `python3 app.py` resolves aws-cdk-lib. Region comes from config.
CDK := cd $(CDK_DIR) && PATH="$(CDK_DIR)/.venv/bin:$$PATH" \
       AWS_REGION=$(AWS_REGION) CDK_DEFAULT_REGION=$(AWS_REGION) npx -y aws-cdk@2

# Ansible via uv (the `ansible` bundle ships ansible.posix + community.general).
ANSIBLE_PLAYBOOK := uvx --from ansible ansible-playbook

# Query a CloudFormation stack output by key.
define stack_out
aws cloudformation describe-stacks --stack-name $(STACK) --region $(AWS_REGION) \
  --query "Stacks[0].Outputs[?OutputKey=='$(1)'].OutputValue" --output text
endef

# Guard: required config must be present.
aws-config:
	@test -f $(AWS_ENV) || { echo "ERROR: infra/aws.env not found. Copy infra/aws.env.example and fill it in."; exit 1; }
	@test -n "$(AWS_REGION)" || { echo "ERROR: AWS_REGION not set in infra/aws.env"; exit 1; }
	@test -n "$(SSH_ALLOWED_IP)" || { echo "ERROR: SSH_ALLOWED_IP not set in infra/aws.env"; exit 1; }
	@echo "Config OK  region=$(AWS_REGION)  ssh_ip=$(SSH_ALLOWED_IP)  instance=$(INSTANCE_TYPE)  domain=$(DOMAIN_NAME:%=%)"

# One-time: install the CDK Python env, AWS CLI, and Ansible tooling.
aws-prereqs:
	@command -v aws >/dev/null 2>&1 || { echo "AWS CLI v2 not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"; exit 1; }
	@command -v uv >/dev/null 2>&1 || { echo "uv not found. Install: curl -LsSf https://astral.sh/uv/install.sh | sh"; exit 1; }
	@command -v npx >/dev/null 2>&1 || { echo "npx (Node.js) not found. Install Node.js 20+."; exit 1; }
	uv venv $(CDK_DIR)/.venv
	uv pip install --python $(VENV_PY) -r $(CDK_DIR)/requirements.txt
	uvx --from ansible ansible-galaxy collection install -r $(ANSIBLE_DIR)/requirements.yml
	@echo "Prereqs installed. Next: make aws-bootstrap (first time), then make aws-up."

# One-time per account/region: prepare CDK deployment resources.
aws-bootstrap: aws-config
	$(CDK) bootstrap

# Synthesize the CloudFormation template (no AWS calls unless a domain is set).
aws-synth: aws-config
	$(CDK) synth $(CDK_CTX)

# Deploy / update the infrastructure.
aws-deploy: aws-config
	$(CDK) deploy $(CDK_CTX) --require-approval never

# Fetch the SSH private key from Secrets Manager into infra/.ssh (chmod 600).
aws-key: aws-config
	@mkdir -p $(dir $(KEY_PATH))
	@aws secretsmanager get-secret-value --secret-id mecoil/ssh-private-key \
	  --region $(AWS_REGION) --query SecretString --output text > $(KEY_PATH)
	@chmod 600 $(KEY_PATH)
	@echo "SSH key written to $(KEY_PATH)"

# Configure the running instance with Ansible (installs Node, app, Caddy, auto-shutdown).
aws-provision: aws-config aws-key
	@IP=$$($(call stack_out,PublicIp)); \
	test -n "$$IP" || { echo "ERROR: could not read PublicIp output — is the stack deployed?"; exit 1; }; \
	echo "Provisioning $$IP ..."; \
	printf '[mecoil]\n%s ansible_user=ec2-user ansible_ssh_private_key_file=%s ansible_ssh_common_args=\047-o StrictHostKeyChecking=accept-new\047\n' "$$IP" "$(KEY_PATH)" > $(ANSIBLE_DIR)/inventory.ini; \
	$(ANSIBLE_PLAYBOOK) -i $(ANSIBLE_DIR)/inventory.ini $(ANSIBLE_DIR)/playbook.yml \
	  -e "repo_src=$(REPO_ROOT)" -e "mecoil_domain=$(DOMAIN_NAME)"

# Full stand-up: deploy infra then provision it.
aws-up: aws-deploy aws-provision
	@IP=$$($(call stack_out,PublicIp)); \
	echo ""; echo "Done. Open: https://$${DOMAIN_NAME:-$$IP}"; \
	echo "(accept the self-signed warning if no domain is configured)"

# Open an SSH session to the server.
ssh: aws-key
	@IP=$$($(call stack_out,PublicIp)); \
	test -n "$$IP" || { echo "ERROR: could not read PublicIp output — is the stack deployed?"; exit 1; }; \
	echo "Connecting to ec2-user@$$IP ..."; \
	ssh -i $(KEY_PATH) -o StrictHostKeyChecking=accept-new ec2-user@$$IP

# Start / stop / status of the instance (auto-stops itself after 4h anyway).
aws-start: aws-config
	@ID=$$($(call stack_out,InstanceId)); aws ec2 start-instances --instance-ids $$ID --region $(AWS_REGION) --output table
	@echo "Starting $$ID ... (SSH/HTTPS available in ~30s; Elastic IP is unchanged)"

aws-stop: aws-config
	@ID=$$($(call stack_out,InstanceId)); aws ec2 stop-instances --instance-ids $$ID --region $(AWS_REGION) --output table

aws-status: aws-config
	@ID=$$($(call stack_out,InstanceId)); \
	aws ec2 describe-instances --instance-ids $$ID --region $(AWS_REGION) \
	  --query "Reservations[0].Instances[0].{State:State.Name,Type:InstanceType,PublicIp:PublicIpAddress}" --output table

# Tear everything down.
aws-destroy: aws-config
	$(CDK) destroy $(CDK_CTX) --force
