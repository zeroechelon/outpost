# =============================================================================
# Outpost v2 Aider Agent Container
# =============================================================================
# Extends outpost-base with Aider AI coding assistant
# Model: DeepSeek Coder / DeepSeek Chat via DEEPSEEK_API_KEY
# =============================================================================

# Configurable base image (local vs ECR)
ARG BASE_IMAGE=outpost-base:latest
FROM ${BASE_IMAGE}

# Image metadata labels
LABEL maintainer="Zero Echelon <platform@zeroechelon.com>" \
      org.opencontainers.image.title="Outpost v2 Aider Agent" \
      org.opencontainers.image.description="Aider AI coding assistant agent for Outpost multi-agent platform" \
      org.opencontainers.image.version="2.0.0" \
      org.opencontainers.image.vendor="Zero Echelon" \
      org.opencontainers.image.source="https://github.com/rgsuarez/outpost" \
      org.opencontainers.image.licenses="Proprietary" \
      outpost.agent.name="aider" \
      outpost.agent.provider="deepseek" \
      outpost.agent.models="deepseek/deepseek-coder,deepseek/deepseek-chat"

# Switch to root for package installation
USER root

# Create agent-specific directories
RUN mkdir -p /opt/agents/aider \
    && chown -R outpost:outpost /opt/agents

# Switch back to outpost user for pip install
USER outpost

# Install Aider via pip (user install to avoid permission issues)
# Using --break-system-packages for Ubuntu 24.04 PEP 668 compliance
RUN pip3 install --user --no-cache-dir aider-chat \
    && aider --version

# Copy initialization script
COPY --chown=outpost:outpost init.sh /opt/agents/aider/init.sh
RUN chmod +x /opt/agents/aider/init.sh

# Environment variables for Aider agent
ENV OUTPOST_AGENT=aider \
    # Default model (can be overridden at runtime)
    AIDER_MODEL=deepseek/deepseek-coder \
    # Autonomous mode settings
    AIDER_YES=true \
    AIDER_AUTO_COMMITS=true \
    # Git identity for Aider commits
    GIT_AUTHOR_NAME="Aider Agent (Outpost)" \
    GIT_COMMITTER_NAME="Aider Agent (Outpost)" \
    GIT_AUTHOR_EMAIL="aider@outpost.zeroechelon.com" \
    GIT_COMMITTER_EMAIL="aider@outpost.zeroechelon.com" \
    # Aider configuration
    AIDER_NO_SUGGEST_SHELL_COMMANDS=true \
    AIDER_NO_SHOW_DIFFS=false \
    # Path to init script
    AGENT_INIT_SCRIPT=/opt/agents/aider/init.sh

# DEEPSEEK_API_KEY must be provided at runtime (not hardcoded!)
# Container will fail fast if not set (validated in init.sh)

# Working directory
WORKDIR /workspace

# Healthcheck - verify aider is accessible
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD aider --version > /dev/null 2>&1 || exit 1

# Default entrypoint runs init script then executes command
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/bash", "-c", "source /opt/agents/aider/init.sh && exec \"$@\"", "--"]

# Default command (typically overridden by task dispatcher)
CMD ["aider", "--help"]
