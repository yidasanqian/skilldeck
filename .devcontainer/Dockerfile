FROM registry.cn-hangzhou.aliyuncs.com/acs/ubuntu:22.04

ARG NODE_VERSION=22.13.1
ARG RUST_TOOLCHAIN=stable

ENV DEBIAN_FRONTEND=noninteractive
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ENV RUSTUP_DIST_SERVER=https://rsproxy.cn
ENV RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup

RUN sed -i 's|archive.ubuntu.com|mirrors.aliyun.com|g; s|security.ubuntu.com|mirrors.aliyun.com|g' /etc/apt/sources.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    tar \
    xz-utils \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libwebkit2gtk-4.1-dev \
    libxdo-dev \
    wget \
    file \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN arch="$(dpkg --print-architecture)" \
  && case "$arch" in \
    amd64) node_arch="x64" ;; \
    arm64) node_arch="arm64" ;; \
    *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
  esac \
  && curl -fsSL "https://mirrors.aliyun.com/nodejs-release/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -o /tmp/node.tar.xz \
  && mkdir -p /usr/local/lib/nodejs \
  && tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs \
  && ln -s "/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-${node_arch}/bin/node" /usr/local/bin/node \
  && ln -s "/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-${node_arch}/bin/npm" /usr/local/bin/npm \
  && ln -s "/usr/local/lib/nodejs/node-v${NODE_VERSION}-linux-${node_arch}/bin/npx" /usr/local/bin/npx \
  && rm /tmp/node.tar.xz \
  && npm config set registry "$NPM_CONFIG_REGISTRY"

RUN curl -fsSL https://rsproxy.cn/rustup-init.sh -o /tmp/rustup-init.sh \
  && chmod +x /tmp/rustup-init.sh \
  && /tmp/rustup-init.sh -y --default-toolchain "${RUST_TOOLCHAIN}" --profile minimal \
  && rm /tmp/rustup-init.sh

ENV PATH=/root/.cargo/bin:/usr/local/bin:$PATH

RUN mkdir -p /root/.cargo \
  && printf '[source.crates-io]\nreplace-with = "aliyun"\n\n[source.aliyun]\nregistry = "sparse+https://mirrors.aliyun.com/crates.io-index/"\n\n[net]\ngit-fetch-with-cli = true\n' > /root/.cargo/config.toml \
  && rustup component add rustfmt clippy
