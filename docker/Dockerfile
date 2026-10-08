FROM --platform=linux/amd64 ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive PIP_BREAK_SYSTEM_PACKAGES=1
RUN apt-get update && apt-get install -y git python3 python3-pip clang curl binutils-mips-linux-gnu build-essential ripgrep gcc-multilib clang-format libcapstone-dev make sudo libglib2.0-0 && rm -rf /var/lib/apt/lists/*
RUN git config --global --add safe.directory '*'
WORKDIR /ssb
