# Server Setup Guide

> Setting up a Linux or macOS server for Outpost

## Requirements

- Linux (Ubuntu 20.04+, Debian 11+, RHEL 8+) or macOS (12+)
- SSH access with sudo privileges
- Git installed
- Python 3.9+ (for Aider)
- Node.js 18+ (for Claude Code, Codex)

## Quick Setup

```bash
# Create Outpost directory
sudo mkdir -p /opt/outpost
sudo chown $USER:$USER /opt/outpost
cd /opt/outpost

# Clone repository
git clone https://github.com/zeroechelon/outpost.git .

# Configure environment
cp .env.template .env
nano .env  # Add your credentials

# Make scripts executable
chmod +x scripts/*.sh

# Install agents
./scripts/setup-agents.sh
```

## Dependencies by OS

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install -y git python3 python3-pip nodejs npm
```

### RHEL/CentOS/Amazon Linux

```bash
sudo yum install -y git python3 python3-pip nodejs npm
```

### macOS

```bash
# Install Homebrew if not present
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install git python node
```

## Directory Structure

After setup:

```
/opt/outpost/
├── .env                    # Your credentials (git-ignored)
├── scripts/                # Dispatch scripts
├── repos/                  # Cached repo clones (auto-created)
└── runs/                   # Execution artifacts (auto-created)
```

## Verification

```bash
# Test basic dispatch
./scripts/dispatch-unified.sh <your-repo> "echo test" --executor=aider

# Check results
ls runs/
```

## Remote Access

### SSH

```bash
ssh user@server "/opt/outpost/scripts/dispatch-unified.sh repo \"task\" --executor=aider"
```

### AWS SSM (optional)

If server has SSM agent:

```bash
aws ssm send-command \
  --instance-ids "<instance-id>" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["cd /opt/outpost && ./scripts/dispatch-unified.sh repo \"task\" --executor=aider"]'
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Permission denied | `chmod +x scripts/*.sh` |
| Python not found | Install Python 3.9+ |
| npm not found | Install Node.js 18+ |
| Git clone fails | Check GITHUB_TOKEN in .env |

