import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 桌面端只复制 Next.js 的最小生产运行集，避免把源码、测试资料、
  // 本地数据库或开发配置带进安装包。
  output: "standalone",
};

export default nextConfig;
