#!/usr/bin/env python3
"""CDK app entry point for the MeCoil game server.

Configuration is passed as CDK context (`-c key=value`) by the Make targets,
which read `infra/aws.env`. AWS credentials come from the environment (standard
AWS SDK credential chain) and are never read from this repo.
"""
import os

import aws_cdk as cdk

from mecoil.server_stack import MeCoilServerStack

app = cdk.App()


def ctx(name: str, default: str | None = None) -> str | None:
    """Read a context value, treating empty strings as unset."""
    value = app.node.try_get_context(name)
    if value is None or value == "":
        return default
    return value


region = ctx("region") or os.environ.get("CDK_DEFAULT_REGION")
account = os.environ.get("CDK_DEFAULT_ACCOUNT")

MeCoilServerStack(
    app,
    "MeCoilServerStack",
    ssh_ip=ctx("ssh_ip"),
    instance_type=ctx("instance_type", "t4g.micro"),
    key_name=ctx("key_name", "mecoil-server-key"),
    duckdns_subdomain=ctx("duckdns_subdomain"),
    env=cdk.Environment(account=account, region=region),
    description="MeCoil laser-tag game server: t4g.micro + Caddy TLS, locked-down SG.",
)

app.synth()
