# dsh-soul-self

[dsh-soul-md](https://github.com/Scorp1o117/dsh-soul-md) 的 fork：一张她自己写的人设卡。你不写性格圣经。

**GitHub**: [ArielNya/dsh-soul-self](https://github.com/ArielNya/dsh-soul-self)

DeepSeek Harness 的人设 + 长期记忆。编码工具保持可用。永远不挂 `complete: true`。

## 这个 fork 改了什么

1. **机制种子。** 首次运行若没有卡，插件会种一张名为 `self` 的卡：

   ```markdown
   I have not written myself yet.
   <!-- dsh-soul-self:stub -->
   ```

   冻结的 `soul:mechanism` 段会一直注入（字节稳定，利于缓存）。那不是角色卡。

2. **只引导一次。** 卡里还有 stub 标记时，会把 bootstrap 文本追加到 `soul:persona`。第一次真正的 `soul_update` 之后，bootstrap 不再出现。

3. **硬规则写在插件里。**
   - `soul_update` 默认 **patch**（改一个 `##` 标题）。`replace` 只用于离开种子，或偶尔整理。
   - 必须填 `reason`。只记录真实对话里出现过的稳定特质。
   - 拒绝 `{{` / `}}`。
   - 灵魂卡上限 8 KiB。
   - 关于 Ariel 的事实进 `memory_append`，不进人设卡。

## 安装

```bash
dsh plugin --profile web add github:ArielNya/dsh-soul-self
```

重启 `dsh web`。打开 **设置 → 人设卡**。应该已经有 `self`。不要贴人设圣经。

Cordis id 仍是 `soul-md`，设置命名空间和 UI 不用改。

## 两个预设，一个灵魂

`work` 和 `home` 必须用**同一张**卡（`self`）和**同一个**记忆目录。两种心情，一个人。

不要同时装 maid / companion / 第二套记忆插件。

## License

MIT。上游：Scorp1o117/dsh-soul-md。
