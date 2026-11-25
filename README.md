# DSH 上下文压缩模型设置插件

给 DeepSeek Harness（DSH）的设置页加一张 **压缩（Compaction）** 卡片，让你把“上下文压缩”这个后台任务固定到指定的模型和渠道上。

默认情况下，DSH 压缩历史对话时会跟着当前会话用的模型走。如果你用的模型渠道不支持这种“后台压缩请求”，就容易报错。装上这个插件后，可以给压缩任务单独指定一个靠谱的模型和参数。

插件只改一个地方：当前 profile 的 `cordis.patch.yml` 里 `compaction-basic` 那一段。它不会改你的聊天模型。

当前版本：**0.2.1**（状态同步修复版，配置已生效时会明确显示“已生效”，不再卡在“热重载中”）。

---

## 在新设备上安装

前提：新设备已经装好 DSH 0.2.0+ 并运行着 web profile，能打开它的网页界面（默认 `http://127.0.0.1:3080`）。本插件是 web profile 专用，其他 profile 不显示设置卡片。

DSH 把插件叫“组合包（bundle）”。安装入口在：

> **全局面板 → 插件 → 添加插件**

弹窗里只有一个输入框，叫 **“包名或地址”**。把下面任意一种东西粘进去，点“安装”即可。

### 方式一：先把 tgz 下载到本机（最稳，推荐）

1. 拿到 `hbk-dsh-compaction-setmodel-0.2.1.tgz`（本仓库 `plugin/` 目录下的文件，或 GitHub Release 附件），放到新设备任意目录，比如 `D:\plugins\`。
2. 打开 DSH → 全局面板 → 插件 → 添加插件。
3. 在“包名或地址”里填这个文件的 **完整路径**（必须是绝对路径，不能写 `.\xxx`）：

   ```text
   D:\plugins\hbk-dsh-compaction-setmodel-0.2.1.tgz
   ```

4. 点“安装”，看到“已安装”就成功了。

这种方式不依赖网络，也不受 GitHub 能不能访问的影响。

### 方式二：直接贴 GitHub Release 的 tgz 直链（最省事）

如果仓库已经发了 Release，把附件的直链粘进同一个输入框：

```text
https://github.com/ILVACM/DSH-SetModel-for-ContextCompression/releases/download/v0.2.1/hbk-dsh-compaction-setmodel-0.2.1.tgz
```

DSH 会自己下载并安装。

**注意**：这个链接要求新设备能直接访问 GitHub，国内网络通常要配代理。如果连不上，就改用方式一。DSH 的 tgz 直链不走 npm 镜像，换安装源也没用。

### 方式三：贴 GitHub 仓库地址（不推荐直接这么装）

输入框也接受仓库地址，比如：

```text
https://github.com/ILVACM/DSH-SetModel-for-ContextCompression.git
```

但有个坑：源码仓库默认不跟踪 `plugin/*.tgz`，也就是说 **直接 clone 仓库通常拿不到安装包**。除非仓库里已经把 tgz 作为发布文件放进去（Release 附件，或维护者手动 `git add -f`），否则这种方式会失败。所以优先用方式一或方式二。

### 用 dsh 命令行安装（不想点界面时）

DSH 自带 `dsh plugin` 命令。它本质是把参数转给 pnpm，并**自动把新插件登记进当前 profile 的 bundle 列表**，不用你手改 `package.json`。

但要注意：**只给仓库地址是不行的**，原因有三个：

1. 插件包在仓库的 `plugin/` 子目录，仓库根目录不是插件包；`dsh plugin add <仓库地址>` 装的是根目录，找不到插件声明。
2. DSH 从 Git 安装插件会走构建流程，还需要额外放行构建脚本，比较麻烦。
3. 仓库不提交编译好的 `lib/`，源码里也没有 `prepare` 脚本，从 Git 直接装下来是**没有可运行代码**的。

所以命令行安装同样要用 tgz：

```powershell
# 先把 tgz 拿到本地：clone 仓库，或从 GitHub Release 下载
git clone https://github.com/ILVACM/DSH-SetModel-for-ContextCompression.git
cd DSH-SetModel-for-ContextCompression

# 安装（必须是绝对路径）
dsh plugin --profile web add "D:\DSH-SetModel-for-ContextCompression\plugin\hbk-dsh-compaction-setmodel-0.2.1.tgz"
```

装完后 **完全重启 DSH**，让它加载新的插件模块。新设备建议先启动一次 DSH，让 `web` profile 初始化好，再跑命令。

如果提示“已安装”，先移除再装：

```powershell
dsh plugin --profile web remove @hbk/dsh-compaction-setmodel
```

### 装完以后

- 全新安装通常会自动生效；如果设置页没出现卡片，重启一下 DSH 再刷新页面。
- 升级旧版：如果 DSH 提示“该插件已安装”，先在插件页卸载旧版，再按上面步骤装新版。
- 不需要额外安装压缩后端：`@deepseek-ai/dsh-compaction-basic` 是 DSH 自带的，插件只是给它提供可视化设置。

---

## 装完怎么用

1. 打开 DSH 设置页，找到 **压缩** 卡片。
2. 模型模式选 **专用模型**，填上 provider 和 model，例如：
   - provider：`nvidia`
   - model：`nvidia/nemotron-3-ultra-550b-a55b`
3. 按需调整保留比例、自动压缩、重试次数等参数。
4. 点保存。DSH 会热重载配置。

### 怎么确认真的生效了

卡片底部有一行状态，正常情况下显示 **“已生效”**，并标出：

- 依据来源（运行中实例，或已沉降的配置行）
- 最近确认时间
- 观察到几次配置重组

如果显示“需重启 DSH 才能生效”，说明 DSH 自己报告了必须重启；如果显示“无法确认”，点 **“再检查一次”** 即可，卡片会说明原因。

### 手动压缩一次

卡片上的压缩按钮会对当前会话跑一次压缩。它调用的是 DSH 内部的压缩服务，和 `/compact` 命令是同一套逻辑，但能把真实的失败原因（比如缺 API key）显示出来。

---

## 校验包是否完整（可选）

0.2.1 的 SHA256：

```text
8040741EFE2136C10F10E3B8E30AF876FC15B4A13C3294163696FD5B6EE2EF0E
```

Windows PowerShell：

```powershell
Get-FileHash .\hbk-dsh-compaction-setmodel-0.2.1.tgz -Algorithm SHA256
```

---

## 常见问题

**Q：安装时提示“无法访问 GitHub”或超时？**
A：tgz 直链不经过 npm 镜像，只能用方式一，把文件下载到本地再填绝对路径。

**Q：提示“该插件已安装”？**
A：先在插件页卸载旧版，再装新版。同一版本重新安装不会刷新已加载的模块。

**Q：装好了但设置页没有卡片？**
A：完全退出 DSH 再启动，刷新页面。客户端界面代码有时需要重启才会更新。

**Q：插件会改我的聊天模型吗？**
A：不会。它只写 `cordis.patch.yml` 里 `compaction-basic` 那一段，只影响压缩任务。

**Q：怎么卸载 / 回滚？**
A：在插件页卸载即可，设置页卡片会消失。插件写进 `cordis.patch.yml` 的压缩参数会保留。要回退到旧版，卸载后安装 `hbk-dsh-compaction-setmodel-0.2.0.tgz`。

---

## 更多信息

设计思路、实现细节和施工记录分别在 `docs/plan.md`、`docs/design.md`、`docs/code.md`。
