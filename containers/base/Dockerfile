# =============================================================================
# Outpost v2 Base Container
# =============================================================================
# Multi-stage build for production-grade agent execution environment
# Target: < 2GB final image size
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder - Install build dependencies and compile tools
# -----------------------------------------------------------------------------
FROM ubuntu:24.04 AS builder

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS from NodeSource
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain (for agents that need it)
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal \
    && rustup component add rustfmt clippy \
    && chmod -R a+rx /usr/local/rustup /usr/local/cargo

# -----------------------------------------------------------------------------
# Stage 2: Runtime - Minimal production image
# -----------------------------------------------------------------------------
FROM ubuntu:24.04 AS runtime

# Image metadata labels
LABEL maintainer="Zero Echelon <platform@zeroechelon.com>" \
      org.opencontainers.image.title="Outpost v2 Base" \
      org.opencontainers.image.description="Base container for Outpost multi-agent execution platform" \
      org.opencontainers.image.version="2.0.0" \
      org.opencontainers.image.vendor="Zero Echelon" \
      org.opencontainers.image.source="https://github.com/rgsuarez/outpost" \
      org.opencontainers.image.licenses="Proprietary"

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install runtime dependencies in a single layer to minimize image size
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Core utilities
    ca-certificates \
    git \
    bash \
    curl \
    wget \
    jq \
    # ripgrep for fast code search
    ripgrep \
    # Python 3.12 with pip and venv (Ubuntu 24.04 default)
    python3 \
    python3-venv \
    python3-pip \
    # Additional utilities needed by agents
    openssh-client \
    gnupg \
    unzip \
    # Process management
    tini \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Set Python 3 as default python (Ubuntu 24.04 uses Python 3.12)
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3 1

# Install Node.js 20 LTS directly in runtime stage (cleaner than multi-stage copy)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy Rust toolchain from builder stage
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
COPY --from=builder /usr/local/rustup /usr/local/rustup
COPY --from=builder /usr/local/cargo /usr/local/cargo

# Create non-root user with proper home directory
# Use --force flag to handle existing GID/UID in Ubuntu 24.04 base image
RUN groupadd --gid 1000 --force outpost \
    && useradd --uid 1000 --gid 1000 --shell /bin/bash --create-home --non-unique outpost || true

# Create workspace directory with proper permissions
RUN mkdir -p /workspace \
    && chown -R outpost:outpost /workspace \
    && chmod 755 /workspace

# Create directories for agent-specific configurations
RUN mkdir -p /opt/outpost/bin /opt/outpost/config \
    && chown -R outpost:outpost /opt/outpost

# Configure npm to use user directory (avoid permission issues)
ENV NPM_CONFIG_PREFIX=/home/outpost/.npm-global \
    PATH=/home/outpost/.npm-global/bin:$PATH

# Configure pip to use user directory
ENV PIP_USER=1 \
    PYTHONUSERBASE=/home/outpost/.local \
    PATH=/home/outpost/.local/bin:$PATH

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER outpost

# Ensure npm global directory exists with correct permissions
RUN mkdir -p /home/outpost/.npm-global \
    && mkdir -p /home/outpost/.local/bin

# Verify installations (build-time validation)
RUN node --version \
    && npm --version \
    && python3 --version \
    && pip3 --version \
    && git --version \
    && rustc --version \
    && cargo --version \
    && rg --version \
    && jq --version

# Environment variables for runtime
ENV OUTPOST_VERSION=2.0.0 \
    OUTPOST_AGENT=base \
    WORKSPACE_DIR=/workspace \
    # Disable Python bytecode caching (container is ephemeral)
    PYTHONDONTWRITEBYTECODE=1 \
    # Unbuffered output for real-time logging
    PYTHONUNBUFFERED=1 \
    # Node.js production mode
    NODE_ENV=production \
    # Git configuration for agent commits
    GIT_AUTHOR_NAME="Outpost Agent" \
    GIT_COMMITTER_NAME="Outpost Agent"

# Use tini as init system for proper signal handling
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]

# Default command (overridden by agent-specific containers)
CMD ["bash"]
