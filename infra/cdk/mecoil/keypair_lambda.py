"""Custom-resource handler that manages an EC2 SSH key pair whose private key
lives in Secrets Manager.

Runs on the Lambda Python runtime with only boto3 available (no external deps,
no bundling). `ec2:CreateKeyPair` generates the key pair *and* returns the
private key material in the API response, so no crypto library is needed.

Contract (via aws-cdk `custom_resources.Provider`):
  ResourceProperties: { KeyName, SecretArn }
  Create/Update -> generate key pair, store private key PEM in the secret
  Delete        -> delete the EC2 key pair (the secret is removed by CloudFormation)
"""
import boto3
from botocore.exceptions import ClientError

ec2 = boto3.client("ec2")
secrets = boto3.client("secretsmanager")


def _create_key(key_name: str, secret_arn: str) -> dict:
    # Recreate cleanly if a key of this name already exists (retry / re-deploy),
    # otherwise the stored secret would not match the live key pair.
    try:
        ec2.delete_key_pair(KeyName=key_name)
    except ClientError:
        pass

    result = ec2.create_key_pair(
        KeyName=key_name,
        KeyType="ed25519",
        TagSpecifications=[
            {
                "ResourceType": "key-pair",
                "Tags": [{"Key": "Project", "Value": "MeCoil"}],
            }
        ],
    )
    secrets.put_secret_value(SecretId=secret_arn, SecretString=result["KeyMaterial"])
    return {
        "PhysicalResourceId": result["KeyPairId"],
        "Data": {"KeyName": key_name, "KeyPairId": result["KeyPairId"]},
    }


def handler(event, _context):
    request_type = event["RequestType"]
    props = event["ResourceProperties"]
    key_name = props["KeyName"]
    secret_arn = props["SecretArn"]

    if request_type == "Create":
        return _create_key(key_name, secret_arn)

    if request_type == "Update":
        old_key_name = event.get("OldResourceProperties", {}).get("KeyName")
        if old_key_name == key_name:
            # Nothing relevant changed — keep the existing key pair and secret.
            return {
                "PhysicalResourceId": event["PhysicalResourceId"],
                "Data": {"KeyName": key_name},
            }
        # Key name changed: create the new key. CloudFormation then issues a
        # Delete for the old physical resource id.
        return _create_key(key_name, secret_arn)

    if request_type == "Delete":
        try:
            ec2.delete_key_pair(KeyName=key_name)
        except ClientError:
            pass
        return {"PhysicalResourceId": event["PhysicalResourceId"]}

    raise ValueError(f"Unexpected RequestType: {request_type}")
