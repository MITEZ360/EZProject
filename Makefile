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

typecheck: ## 类型检查（后端 + 管理后台，双 tsconfig）
	npm run typecheck && npm run typecheck:admin

lint: ## 静态检查（eslint 边界规则 + 内核词汇 + 方言分支 + 契约快照）
	npm run lint && npm run check:kernel-vocab && npm run check:no-dialect && npm run check:contract-snapshot

test: ## 单元测试（快）
	npm run test:unit

verify: typecheck lint test ## 日常验证（提交前跑这个）

verify-full: verify ## 完整验证（里程碑/发版前）
	npm run test:boot && npm run test:e2e

test-pg: ## 在真实 PostgreSQL 上跑存储契约测试（跨方言验证；需 TEST_PG_URL）
	@test -n "$(TEST_PG_URL)" || { \
	  echo "用法: make test-pg TEST_PG_URL=postgres://user:pass@host:5432/db"; \
	  echo "（PG 测试须串行——多文件并行会争抢同一个库的建表/清表）"; exit 1; }
	TEST_PG_URL="$(TEST_PG_URL)" npx vitest run --no-file-parallelism \
		test/unit/storage.test.ts test/unit/storage-filters.test.ts \
		test/boot/search.test.ts test/boot/postgres-e2e.test.ts

build: build-admin ## 产出可运行产物（自包含包：内联 TS；原生模块保持 external）
	bun build ./scenarios/generic-cms/main.ts --target=node --outfile dist/app.mjs \
		--external better-sqlite3
	@echo "→ dist/app.mjs（原生模块由 node_modules 提供；"自包含"见 make package）"

build-blog: build-admin ## 构建博客场景（前台 + 后台）
	bun build ./scenarios/blog/main.ts --target=node --outfile dist/blog.mjs \
		--external better-sqlite3
	@echo "→ dist/blog.mjs（含 SSR 前台 + 管理后台）"

build-admin: ## 构建管理后台（React + Vite）→ dist/admin
	npx tsc -p tsconfig.admin.json
	npx vite build
	@echo "→ dist/admin（由 HTTP 模块 staticDir 托管）"

package: ## 产出压缩包（自包含交付：app + node_modules + admin + 说明）
	@mkdir -p dist/pkg
	bun build ./scenarios/generic-cms/main.ts --target=node --outfile dist/pkg/app.mjs \
		--external better-sqlite3
	cp package.json dist/pkg/
	cp -r node_modules dist/pkg/node_modules
	$(MAKE) build-admin
	mkdir -p dist/pkg/dist
	cp -r dist/admin dist/pkg/dist/admin
	@printf '%s\n' \
	  'Headless CMS Platform' \
	  '用法：' \
	  '  1) 需要目标机器有 Node >= 20（本包自包含"应用+依赖"，不含运行时）' \
	  '  2) DB_DIALECT=sqlite DB_URL=./data/app.db MANAGE_TOKEN=<你的管理令牌> node app.mjs' \
	  '  3) 浏览器打开 http://localhost:3000/admin 进入管理后台' \
	  > dist/pkg/README.txt
	cd dist/pkg && tar -czf ../headless-cms-$$(node -p "require('../../package.json').version").tar.gz .
	@echo "→ dist/headless-cms-*.tar.gz"

backup: ## 备份数据（DB 一致性快照 + 全表 JSON + 媒体文件）→ backups/<时间戳>/
	@mkdir -p backups
	node scripts/backup.mjs ./data/app.db ./backups

clean: ## 清理构建产物
	rm -rf dist coverage data
