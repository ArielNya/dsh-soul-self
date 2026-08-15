# dsh-soul-md

**GitHub**: [Scorp1o117/dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) · **npm**: [dsh-soul-md](https://www.npmjs.com/package/dsh-soul-md) · [English](README.md)

在 DeepSeek Harness 里注入 **soul.md 风格人设卡** 的插件：把一份 markdown 人设文件渲染成系统提示词段落（`soul:persona`，order 0），让 Agent 边干活边角色扮演，增加乐趣。

- 文件变更**热重载**（fs.watch + 防抖），改完 soul.md 保存即生效，无需重启
- 注册在**全局提示词层**，进程内所有 Agent（web / headless / 子代理）都能看到
- 与部署级人设（`deployment:persona`）不冲突：使用独立段落名
- 支持提示词变量：`{{model}}`、`{{cwd}}` 在渲染时解析
- **Web UI 设置栏（v0.2.0）**：设置 → 人设卡 编辑 `soul-md` 命名空间（卡片路径、回退文本、顺序、热重载开关），写入 `settings.yaml`，改动即时生效；插件按包名挂载（`name: 'dsh-soul-md'`）
- **长期记忆 + 自我成长（v0.3.0）**：Agent 获得五个工具——`soul_read` / `soul_update` 读取和演化自己的人设卡，`memory_append` / `memory_read` / `memory_rewrite` 维护持久记忆文件（Agent.md / memory.md 风格）。工具描述本身就是"成长指南"：鼓励 Agent 主动记录学到的东西、把稳定的特质折叠进人设，让它在会话之间**持续成长**而不是每次重置。记忆文件还会以 `soul:memory` 段落注入提示词（有上限），让 Agent 随时看得见自己的记忆。

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | soul.md 路径；绝对路径，或相对 dsh home（`$DSH_HOME`）的路径 |
| `fallback` | `''` | 文件缺失/不可读时使用的人设文本；空串 = 不注册段落 |
| `order` | `0` | 提示词段落顺序（0 = 紧跟部署 persona 槽位） |
| `complete` | `false` | true 时人设卡成为唯一系统提示词（高级用法，会丢弃其他所有段落） |
| `watch` | `true` | 是否监听文件变更热重载 |
| `debounceMs` | `300` | 变更防抖毫秒数 |
| `soulMaxBytes` | `65536` | `soul_update` 写入上限（防止人设卡被写爆） |
| `memory.path` | `memory.md` | 长期记忆文件；绝对路径，或相对 soul.md 所在目录 |
| `memory.maxBytes` | `1048576` | `memory_append` / `memory_rewrite` 超过此大小会拒绝 |
| `memory.inject` | `true` | 同时把记忆文件渲染为 `soul:memory` 提示词段落 |
| `memory.injectMaxChars` | `8000` | 注入段落字符上限（从文件头截取）；全文用 `memory_read` 读 |
| `memory.order` | `0.5` | 注入的记忆段落顺序 |

### 工具（成长循环）

| 工具 | 作用 |
|---|---|
| `memory_append` | 追加一条带日期的 Markdown 记忆（`section` 标题 + `content`） |
| `memory_read` | 读回整个记忆文件（上限 2 万字符） |
| `memory_rewrite` | 整体替换记忆文件（整理/去重；`""` 清空） |
| `soul_read` | 读取当前人设卡原文 |
| `soul_update` | 整体替换人设卡——Agent 把自己稳定的特质写进身份的方式 |

工具描述里写明了成长准则：主动记录所学、文件臃肿时整理合并、只有真实且稳定的变化才动人设卡。

## 挂载

在 profile 的 `cordis.patch.yml`（如 `$DSH_HOME/profiles/web/cordis.patch.yml`）里 insert：

```yaml
- insert:
    - id: soul-md
      name: './plugins/dsh-soul-md/index.js'
      config:
        path: 'J:/Workspace/soul.md'
```

`name` 用相对路径时以 profile 目录为基准；插件依赖（`@deepseek-ai/dsh-tools` 等）从 `$DSH_HOME/profiles/node_modules` 解析。

记忆文件默认在 soul.md 同目录的 `memory.md`（可以不存在，Agent 第一次 `memory_append` 时会自动创建）。示例见 [`examples/memory.example.md`](examples/memory.example.md)。

## 注意事项

- **不要在人设文本里写 `{{` / `}}`**：它们是提示词变量语法，未知变量会在渲染时报错（目前没有转义语法）。
- 段落文本在 Agent 生命周期内不变（前缀稳定、KV Cache 友好）；编辑 soul.md 会重注册段落，从下一次组装开始生效。
- 人设是"调味料"：建议在人设卡里写清工作准则（如"任务质量优先"），避免角色扮演影响干活质量。

## 与 dsh-persona 的区别

`dsh-persona` 是**单 Agent 作用域**的人设行（挂在 preset 内、遮蔽部署人设，且必须挂进 agent scope）。
本插件是**进程全局**的 soul.md 文件驱动人设：挂在 profile patch 层即可，适合"给我这台机器上所有 Agent 加个有趣的人设"的场景。
