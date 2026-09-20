# REFRACT / 折光

**把世界调成你的频率。**

一个面向 Windows 的本地音乐播放器。透出桌面的玻璃、安静的工业风界面，以及属于你自己的音乐收藏。

**A local music player for Windows, with desktop acrylic, synced lyrics, and a quiet industrial interface.**

[下载 v0.9.1 预览版](https://github.com/Polaris-20/refract/releases/tag/v0.9.1) · [使用手册](USER_GUIDE.md) · [报告问题](https://github.com/Polaris-20/refract/issues)

![折光的深色界面与原创演示曲目](docs/preview.png)

*截图展示早期深色界面布局；桌面玻璃会随窗口后方内容变化。*

## 为本地音乐留一个好看的位置

| | |
| --- | --- |
| 桌面玻璃 | 关闭、聚焦时启动、保持三档；聚焦变化沿用 Windows 的自然渐变。 |
| 三种窗口 | 日常听歌的正常窗口、置顶小窗、覆盖任务栏的沉浸模式。 |
| 歌词 | 导入或拖入 LRC / SRT / JSON / TXT；支持同步歌词和独立桌面悬浮歌词。 |
| 声音与颜色 | 实时频谱、封面取色、可调 1–12 秒的歌曲交叉淡化。 |
| 整理收藏 | 歌曲信息和封面编辑、收藏、歌单、拖动队列、下一首播放。 |
| 本地使用 | 无需账号；应用不上传曲库。附三段原创演示声景。 |

## 开始听歌

1. 在 [Releases](https://github.com/Polaris-20/refract/releases/tag/v0.9.1) 下载 **Refract-Windows-v0.9.1.zip**，完整解压到可写文件夹。
2. 安装 [.NET 10 Desktop Runtime x64](https://dotnet.microsoft.com/en-us/download/dotnet/10.0) 和 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)（已安装可跳过）。
3. 打开 `Refract.exe`，点击“试听折光”或导入自己的音乐。

**本次发布面向 Windows 11 x64。** 桌面玻璃需要 Windows 11 22H2 或更新版本；系统关闭透明效果、高对比度或节能策略可能使材质回退。程序本身未签名。

音乐播放取决于系统和 WebView2 的解码能力。MP3、FLAC、WAV、M4A/AAC 已有本地文件测试记录；不支持 DRM 音乐。

## 你的音乐留在本机

- 便携版把曲库、导入的歌词、封面和设置放在程序旁的 `data/`。
- 音乐文件保留在原位置，曲库记录文件路径；搬动音乐后需要重新导入。
- 普通编辑只改曲库。主动选择“写回音乐文件”时，会另行确认并备份原文件。
- **升级时先退出程序，替换程序文件并保留 `data/`。** 不要把自己的 `data/` 上传到 GitHub。

详见 [使用手册](USER_GUIDE.md) 与 [本地数据说明](PRIVACY.md)。

## 预览版的范围

v0.9.1 是首个公开预览版本。它已具备本地播放、歌词和曲库整理的完整使用流程，仍欢迎不同电脑上的反馈。

- 歌曲过渡为交叉淡化，尚无自动对拍或采样级无缝播放。
- 桌面玻璃基于 Windows Acrylic，尚无物理折射或色散。
- 暂无联网找词、均衡器、全局媒体热键和自动更新。
- 未完成跨机器、长时间播放与超大曲库的全面验证。

[本版发布说明](docs/RELEASE-v0.9.1.md) · [验证记录](docs/VALIDATION.md)

## 从源码构建

需要 Windows、.NET 10 SDK。界面使用 HTML / CSS / JavaScript，无 npm 构建步骤。

```powershell
dotnet restore --locked-mode
dotnet build -c Release --no-restore
dotnet run
```

构建便携程序：

```powershell
./scripts/publish.ps1
```

输出到 `dist/REFRACT`。纯逻辑检查与贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可与致谢

应用代码使用 [MIT](LICENSE)，项目原创音频与图形为 CC0-1.0。TagLibSharp 和 WebView2 保留各自许可，见 [第三方说明](THIRD_PARTY_NOTICES.md)。

本项目为独立创作，不隶属于任何音乐平台或游戏公司。



为难以寻找歌词而感到烦恼吗？不妨试试TigerSHe的Moss-Transcribe-WebUI吧！
