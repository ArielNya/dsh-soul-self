# dsh-soul-md

**GitHub**: [Scorp1o117/dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) · **npm**: [dsh-soul-md](https://www.npmjs.com/package/dsh-soul-md) · [English](README.md)

在 DeepSeek Harness 里注入 **soul.md 风格人设卡 + 长期记忆** 的插件：把 markdown 人设文件渲染成系统提示词段落（`soul:persona`），让 Agent 边干活边角色扮演，增加乐趣。

- **多人设三级解析（v0.4.0）**：人设按 会话选择 → 工作区卡片 → 全局 三级解析，**聊天框标题栏一键切换**，会话中途切换从下一轮起效，不同会话可以各带各的人设：
  ```
  会话选择（聊天框切换器）> 工作区卡片（.dsh-persona.md）> 全局默认（path）> 回退文本
  ```
- 段落用**函数文本**按组装时的 agent 上下文解析（工作区来自会话 cwd），mtime 缓存保证稳定卡片字节不变（KV Cache 友好），编辑即时生效、无需 watcher
- 注册在**全局提示词层**，进程内所有 Agent（web / headless / 子代理）都可用；与部署级人设（`deployment:persona`）不冲突
- 支持提示词变量：`{{model}}`、`{{cwd}}` 在渲染时解析
- **多作用域记忆（v0.4.0）**：记忆跟着人设作用域走——角色卡记忆（`<卡片目录>/<名字>.memory.md`）> 工作区记忆（`.dsh-memory.md`）> 全局记忆（`memory.path`）。读取和 `soul:memory` 注入沿链取第一个存在的文件；写入落在当前 Agent 最具体的作用域并自动创建
- **Web UI 设置栏（v0.2.0）**：设置 → 人设卡 编辑 `soul-md` 命名空间（全局卡片、注册表目录、记忆分级），写入 `settings.yaml`，改动即时生效
- **自我成长（v0.3.0）**：`soul_read` / `soul_update` 读写**当前会话生效**的人设卡，`memory_append` / `memory_read` / `memory_rewrite` 读写当前作用域记忆。工具描述就是"成长指南"：主动记录所学、稳定的特质折叠进人设——让 Agent 在会话之间**持续成长**而不是每次重置

## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | 全局默认人设卡；绝对路径，或相对 dsh home（`$DSH_HOME`）的路径 |
| `fallback` | `''` | 解析到的人设卡缺失/不可读时使用的文本；空串 = 不注册段落 |
| `order` | `0` | 人设段落顺序 |
| `complete` | `false` | true 时人设卡成为唯一系统提示词（高级用法，会丢弃其他所有段落） |
| `watch` / `debounceMs` | `true` / `300` | 兼容保留（v0.4 起段落按次组装解析，不再需要 watcher） |
| `soulMaxBytes` | `65536` | `soul_update` 写入上限（防止人设卡被写爆） |
| `personas.dir` | `''` | 人设注册表目录（每张 `*.md` 一张卡）；留空不启用注册表 |
| `personas.workspaceFile` | `.dsh-persona.md` | 工作区人设卡文件名（放在会话工作区目录下） |
| `sessions` | `{}` | 会话级人设选择（sessionId → 人设 key），由聊天框切换器写入 |
| `roster` | `[]` | 可选人设清单（服务端维护，只读） |
| `memory.path` | `memory.md` | 全局记忆文件；绝对路径，或相对全局卡所在目录 |
| `memory.workspaceFile` | `.dsh-memory.md` | 工作区记忆文件名（放在会话工作区目录下） |
| `memory.maxBytes` | `1048576` | `memory_append` / `memory_rewrite` 超过此大小会拒绝 |
| `memory.inject` | `true` | 同时把记忆渲染为 `soul:memory` 提示词段落 |
| `memory.injectMaxChars` | `8000` | 注入段落字符上限（从文件头截取）；全文用 `memory_read` 读 |
| `memory.order` | `0.5` | 注入的记忆段落顺序 |

人设 key：`""`（自动：工作区 → 全局）、`global`、`workspace`、`registry:<名字>`（注册表目录里的卡）。工作区卡/记忆放在会话工作区目录里，一个进程可以同时服务多个工作区、各自不同人设和记忆。

### 工具（成长循环）

| 工具 | 作用 |
|---|---|
| `memory_append` | 追加一条带日期的 Markdown 记忆到**当前作用域**（角色卡 > 工作区 > 全局） |
| `memory_read` | 读当前作用域记忆，缺失时沿链回退（上限 2 万字符） |
| `memory_rewrite` | 整体替换当前作用域记忆文件（整理/去重；`""` 清空） |
| `soul_read` | 读取当前会话**生效**的人设卡原文 |
| `soul_update` | 整体替换当前生效的人设卡——Agent 把自己稳定的特质写进身份的方式 |

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

全局记忆默认在全局 soul.md 同目录的 `memory.md`（可以不存在，Agent 第一次 `memory_append` 时会自动创建）。工作区记忆（`.dsh-memory.md`）和角色卡记忆（`<卡片名>.memory.md`）同样按需自动创建。示例见 [`examples/memory.example.md`](examples/memory.example.md)。

## 注意事项

- **不要在人设文本里写 `{{` / `}}`**：它们是提示词变量语法，未知变量会在渲染时报错（目前没有转义语法）。
- 人设/记忆段落按组装解析（mtime 缓存），稳定时字节不变、KV Cache 友好；切人设或改文件从下一次组装起生效。
- 会话选择了已删除的人设卡时会静默沿链回退；聊天框切换器会显示失效的选项，方便修正。
- 人设是"调味料"：建议在人设卡里写清工作准则（如"任务质量优先"），避免角色扮演影响干活质量。

## 与 dsh-persona 的区别

`dsh-persona` 是**单 Agent 作用域**的人设行（挂在 preset 内、遮蔽部署人设，且必须挂进 agent scope）。
本插件是**进程全局**的 soul.md 文件驱动人设：挂在 profile patch 层即可，适合"给我这台机器上所有 Agent 加个有趣的人设"的场景。
