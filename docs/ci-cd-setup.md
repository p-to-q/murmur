# CI/CD 配置说明

## 现有配置概览

项目已经配置了完善的 CI/CD 流程，包括：

### 1. 持续集成 (`.github/workflows/ci.yml`)
- ✅ Lint 检查
- ✅ 单元测试
- ✅ 构建审计
- ✅ 本地栈冒烟测试
- ✅ Markdown 链接检查
- ✅ Audio worker 测试

**触发条件**: PR 和 main 分支推送

### 2. 依赖管理 (`.github/dependabot.yml`)
- ✅ NPM 依赖自动更新（每周一 03:00）
- ✅ Python 依赖自动更新（每周一 03:30）
- ✅ GitHub Actions 自动更新（每周一 04:00）
- ✅ 依赖分组（Next.js stack, AWS SDK, Tailwind stack）

### 3. 安全扫描
- ✅ **CodeQL** - 代码安全分析（JavaScript/TypeScript + Python）
- ✅ **Dependency Review** - PR 中新增依赖的安全审查

### 4. 其他自动化
- ✅ **Stale Issues** - 自动关闭过期 issue
- ✅ **Link Check** - 检查文档中的链接有效性
- ✅ **Auto Labeler** - 自动给 PR 和 issue 打标签
- ✅ **Audio Acceptance** - 音频处理质量测试

## 需要启用的功能

某些工作流需要仓库变量才能启用。在 GitHub 仓库设置中添加：

### Repository Variables (Settings → Secrets and variables → Actions → Variables)

```
ENABLE_GHAS_CODEQL=true          # 启用 CodeQL 安全扫描
ENABLE_DEPENDENCY_REVIEW=true    # 启用依赖审查
```

## 配置优化建议

### 1. 添加 PR 大小检查

创建 `.github/workflows/pr-size-check.yml`:

```yaml
name: PR Size Check

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  check-size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const { data: pr } = await github.rest.pulls.get({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number,
            });
            
            const additions = pr.additions;
            const deletions = pr.deletions;
            const changes = additions + deletions;
            
            if (changes > 1000) {
              core.setFailed('PR 过大（' + changes + ' 行变更）。建议拆分成多个小 PR。');
            } else if (changes > 500) {
              core.warning('PR 较大（' + changes + ' 行变更）。考虑拆分？');
            }
```

### 2. 添加提交消息检查

创建 `.github/workflows/commit-lint.yml`:

```yaml
name: Commit Lint

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  lint-commits:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      
      - name: Check commit messages
        run: |
          git log --format=%s origin/${{ github.base_ref }}..HEAD | while read msg; do
            if ! echo "$msg" | grep -qE '^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?: .+'; then
              echo "❌ Invalid commit message: $msg"
              echo "Expected format: type(scope): message"
              exit 1
            fi
          done
```

### 3. 性能预算检查

在 `ci.yml` 中添加构建大小检查：

```yaml
- name: Check bundle size
  run: |
    BUNDLE_SIZE=$(du -sk .next/static | cut -f1)
    MAX_SIZE=10000  # 10MB limit
    if [ $BUNDLE_SIZE -gt $MAX_SIZE ]; then
      echo "❌ Bundle size ($BUNDLE_SIZE KB) exceeds limit ($MAX_SIZE KB)"
      exit 1
    fi
    echo "✅ Bundle size: $BUNDLE_SIZE KB"
```

### 4. 自动发布流程

创建 `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      
      - name: Generate changelog
        run: |
          git log $(git describe --tags --abbrev=0 HEAD^)..HEAD --pretty=format:"- %s (%h)" > CHANGELOG.txt
      
      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          body_path: CHANGELOG.txt
          draft: false
          prerelease: false
```

## 监控和通知

### Slack/Discord 通知（可选）

在任何工作流中添加通知步骤：

```yaml
- name: Notify on failure
  if: failure()
  uses: slackapi/slack-github-action@v2
  with:
    webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
    payload: |
      {
        "text": "❌ CI failed for ${{ github.repository }}",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "Workflow *${{ github.workflow }}* failed\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View run>"
            }
          }
        ]
      }
```

## 当前状态

✅ **基础 CI/CD 已完全配置**
✅ **Dependabot 已配置自动更新**
✅ **安全扫描已配置**（需要启用仓库变量）
⚠️ **可选优化建议**（PR 大小检查、commit lint、性能预算等）

## 下一步

1. 在 GitHub 设置中启用 `ENABLE_GHAS_CODEQL` 和 `ENABLE_DEPENDENCY_REVIEW`
2. 根据团队需求选择性添加上述优化建议
3. 定期查看 Dependabot PRs 并合并
4. 监控 CI 运行时间，必要时优化缓存策略
