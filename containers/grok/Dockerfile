# =============================================================================
# Outpost v2 Grok Agent Container
# =============================================================================
# xAI Grok agent for Outpost multi-agent execution platform
# Uses xAI API (OpenAI-compatible) for code generation tasks
# =============================================================================

# Configurable base image for local builds vs ECR
ARG BASE_IMAGE=outpost-base:latest

FROM ${BASE_IMAGE}

# Image metadata labels
LABEL maintainer="Zero Echelon <platform@zeroechelon.com>" \
      org.opencontainers.image.title="Outpost v2 Grok Agent" \
      org.opencontainers.image.description="xAI Grok agent for Outpost multi-agent execution platform" \
      org.opencontainers.image.version="2.0.0" \
      org.opencontainers.image.vendor="Zero Echelon" \
      org.opencontainers.image.source="https://github.com/rgsuarez/outpost" \
      org.opencontainers.image.licenses="Proprietary" \
      outpost.agent="grok" \
      outpost.provider="xai" \
      outpost.models="grok-4.1,grok-4.1-fast-reasoning"

# Switch to root for package installation
USER root

# Create agent directories
RUN mkdir -p /opt/agents/grok \
    && chown -R outpost:outpost /opt/agents

# Install Python packages required for Grok agent
# - requests: HTTP client for API calls
# - sseclient-py: Server-Sent Events for streaming responses
RUN pip3 install --no-cache-dir \
    requests==2.31.0 \
    sseclient-py==1.8.0

# Copy agent script
COPY --chown=outpost:outpost grok-agent.py /opt/agents/grok/grok-agent.py
RUN chmod +x /opt/agents/grok/grok-agent.py

# Copy initialization script
COPY --chown=outpost:outpost init.sh /opt/agents/grok/init.sh
RUN chmod +x /opt/agents/grok/init.sh

# Switch back to non-root user
USER outpost

# Add agent scripts to PATH
ENV PATH="/opt/agents/grok:${PATH}"

# Grok-specific environment variables
# XAI_API_KEY must be provided at runtime (never hardcoded!)
ENV OUTPOST_AGENT=grok \
    XAI_API_ENDPOINT="https://api.x.ai/v1" \
    GROK_DEFAULT_MODEL="grok-4.1" \
    GROK_FAST_MODEL="grok-4.1-fast-reasoning"

# Working directory
WORKDIR /workspace

# Agent-specific entrypoint
ENTRYPOINT ["/usr/bin/tini", "--", "/opt/agents/grok/init.sh"]

# Default command runs the agent
CMD ["grok-agent.py"]
