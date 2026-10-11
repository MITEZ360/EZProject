# Makefile —— 统一入口（开发/验证/构建）
# 日常：make verify（快，只跑类型+lint+单测）
# 里程碑：make verify-full（加启动测试）
# 交付：make build（单二进制）/ make package（压缩包）
#
# 运行时说明：验证链走 Node（npm run），因为 better-sqlite3 原生模块在 Bun 下不可用；
# Bun 只用于依赖安装与构建加速。详见 docs/dev-log.md。

.PHONY: help install dev typecheck lint test verify verify-full check build package clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## 安装依赖
	bun install

typecheck: ## 类型检查
	npm run typecheck

lint: ## 静态检查（含边界规则、内核词汇扫描、方言分支扫描）
	npm run lint && npm run check:kernel-vocab && npm run check:no-dialect

test: ## 单元测试（快）
	npm run test:unit

verify: typecheck lint test ## 日常验证（提交前跑这个）

verify-full: verify ## 完整验证（里程碑/发版前）
	npm run test:boot && npm run check:contract-snapshot && npm run test:e2e

build: ## 产出单二进制（自包含）
	bun build ./kernel/index.ts --compile --outfile dist/app

package: ## 产出压缩包（自包含）
	@mkdir -p dist && tar -czf dist/headless-cms-$$(node -p "require('./package.json').version").tar.gz kernel modules scenarios package.json

clean: ## 清理构建产物
	rm -rf dist coverage
