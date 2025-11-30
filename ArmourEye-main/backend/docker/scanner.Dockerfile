FROM kalilinux/kali-rolling

# Update package list and install security tools
RUN apt-get update && apt-get install -y \
    nmap \
    gobuster \
    nikto \
    sqlmap \
    hydra \
    dirb \
    dirbuster \
    wfuzz \
    dnsenum \
    dnsrecon \
    netcat-traditional \
    curl \
    wget \
    docker.io \
    ca-certificates \
    ruby \
    ruby-dev \
    python3 \
    python3-pip \
    seclists \
    && rm -rf /var/lib/apt/lists/*

# Install additional Python tools using system packages
RUN apt-get update && apt-get install -y \
    python3-requests \
    python3-bs4 \
    python3-lxml \
    && rm -rf /var/lib/apt/lists/*

# Install Trivy using official install script (avoids missing Release file)
RUN apt-get update && apt-get install -y curl gnupg \
 && curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin \
 && rm -rf /var/lib/apt/lists/*

# Install WhatWeb from source (GitHub) to avoid Debian package path issues
RUN apt-get update && apt-get install -y git bundler build-essential libyaml-dev pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --depth 1 https://github.com/urbanadventurer/WhatWeb.git /tmp/whatweb \
    && mv /tmp/whatweb /usr/share/whatweb \
    && chmod +x /usr/share/whatweb/whatweb \
    && cd /usr/share/whatweb && bundle install --without development test \
    && printf '#!/bin/bash\nexport RUBYLIB=/usr/share/whatweb/lib${RUBYLIB:+:$RUBYLIB}\ncd /usr/share/whatweb && exec ruby /usr/share/whatweb/whatweb "$@"\n' > /usr/local/bin/whatweb \
    && chmod +x /usr/local/bin/whatweb \
    && ln -sf /usr/local/bin/whatweb /usr/bin/whatweb

# Install Docker Scout CLI for container vulnerability intelligence
RUN curl -sSfL https://raw.githubusercontent.com/docker/scout-cli/main/install.sh | sh -s -- -b /usr/local/bin \
    && docker-scout version

# Create directories for scan results and scripts
RUN mkdir -p /scans/results /scans/scripts /scans/logs

# Set Docker host to the mounted Docker socket (provided via docker-compose)
ENV DOCKER_HOST=unix:///var/run/docker.sock

# Set working directory
WORKDIR /scans

# Create a simple scan runner script
RUN echo '#!/bin/bash\n\
# ArmourEye Scanner Runner\n\
# This script runs security tools based on AI decisions\n\
\n\
TOOL=$1\n\
TARGET=$2\n\
OUTPUT_DIR="/scans/results"\n\
\n\
case $TOOL in\n\
    "nmap")\n\
        nmap -sV -sC -oX "$OUTPUT_DIR/nmap_$TARGET.xml" "$TARGET"\n\
        ;;\n\
    "gobuster")\n\
        gobuster dir -u "http://$TARGET" -w /usr/share/wordlists/dirb/common.txt -o "$OUTPUT_DIR/gobuster_$TARGET.txt"\n\
        ;;\n\
    "nikto")\n\
        nikto -h "http://$TARGET" -output "$OUTPUT_DIR/nikto_$TARGET.txt"\n\
        ;;\n\
    "sqlmap")\n\
        sqlmap -u "http://$TARGET" --batch --output-dir="$OUTPUT_DIR/sqlmap_$TARGET"\n\
        ;;\n\
    *)\n\
        echo "Unknown tool: $TOOL"\n\
        exit 1\n\
        ;;\n\
esac\n\
' > /scans/scripts/run_scan.sh && chmod +x /scans/scripts/run_scan.sh

# Default command - keep container running
CMD ["tail", "-f", "/dev/null"]
