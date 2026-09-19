# 参与折光

欢迎提交可复现的问题、改进建议和 Pull Request。

## 报告问题

请说明程序版本、Windows 版本、发生问题的窗口模式、复现步骤和预期结果。播放问题请补充文件格式、是否开启交叉淡化；玻璃问题请补充玻璃档位、轻量视觉和系统透明效果的状态。

截图与日志请隐去个人信息。音乐问题优先使用自己生成、授权或可公开分发的短样本，不需要上传整个曲库。

## 开发与检查

在 Windows 安装 .NET 10 SDK，按 README 构建。Node.js 用于运行纯逻辑检查，不参与应用运行。

```powershell
node scripts/test-lyrics.cjs
node scripts/test-audio-engine.cjs
node scripts/test-transitions.cjs
node scripts/test-personalization.cjs
node scripts/test-glass-modes.cjs
./scripts/test-glass-policy.ps1
```

这些检查不证明真实音频听感或 Windows 材质显示。涉及窗口、歌词、播放的改动，请描述手动验证结果，并保持未验证部分清楚可见。

`--ui-test` 会启动界面并操作测试曲库，只应在自己明确选择的独立测试目录中运行。不要对真实个人曲库运行它。

## 提交改动

- 一次改动解决一个清楚的问题，说明触发方式、修改后的行为及验证结果。
- 保持导入与写回的区别：未经用户确认不要改动原音乐。
- 保持播放通路、窗口焦点和本地数据的既有行为，避免为视觉效果引入屏幕采集。
- 不要提交 `data/`、`bin/`、`obj/`、音乐标签备份、访问凭据或个人路径。
- 新增依赖或资产时注明来源与许可。
