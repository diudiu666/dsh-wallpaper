## 做了什么 / What changed

<!-- 一句话说明这个 PR 改变了什么行为。 -->

## 为什么 / Why

<!-- 关联 issue（如有）：Fixes #123。说明根因，而不是只描述症状。 -->

## 验证 / Verification

- [ ] `npm test`
- [ ] `npm run pack:check`
- [ ] 在真实 DSH Desktop 上手动验证（版本 / 平台 / 壁纸类型：视频 / 场景 / 图片）

验证环境：

- DSH 版本：
- 操作系统：
- Wallpaper Engine 壁纸类型：

## 检查清单 / Checklist

- [ ] 没有新增运行时依赖（零依赖是硬约束）/ no new runtime dependencies
- [ ] 没有硬编码本机路径 / no hard-coded machine paths
- [ ] 新增/修改的解析分支在 `/dsh-wallpaper/status` 的 `trace` 里有记录
- [ ] 用户可见的改动已写入 `CHANGELOG.md` / user-visible changes are in the changelog
- [ ] 客户端行为改动有测试（参考 `test/video.test.js`）/ client changes have tests
