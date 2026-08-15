/**
 * dsh-soul-md — browser half.
 *
 * Web UI settings section (人设卡): edits the `soul-md` settings namespace
 * (card path, fallback, order, persona registry, memory scoping, sessions).
 * Plus a per-session persona switcher in the conversation header
 * (`conversation.session.header.actions`), backed by the host-maintained
 * `roster` and the per-session `sessions` map in the same namespace.
 *
 * Hand-written ModuleLoader bundle — no build step required.
 */
window.__ModuleLoader__.load({
  id: "dsh-soul-md",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var h = react.createElement;

    // ── CSS (theme tokens) ────────────────────────────────────────────────
    var CSS = ".__sm_root{max-width:640px;display:flex;flex-direction:column;gap:10px}" +
      ".__sm_field{display:flex;flex-direction:column;gap:4px}" +
      ".__sm_label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px}" +
      ".__sm_override{font-size:10px;color:var(--dsw-alias-state-business-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 4px}" +
      ".__sm_hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}" +
      ".__sm_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font-size:13px;box-sizing:border-box;width:100%}" +
      ".__sm_textarea{min-height:80px;resize:vertical}" +
      ".__sm_row{display:flex;align-items:center;gap:8px}" +
      ".__sm_check{accent-color:var(--dsw-alias-state-business-primary)}" +
      ".__sm_actions{display:flex;gap:8px;align-items:center;margin-top:4px}" +
      ".__sm_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;cursor:pointer}" +
      ".__sm_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}" +
      ".__sm_btn:disabled{opacity:.5;cursor:default}" +
      ".__sm_btnPrimary{border-color:var(--dsw-alias-state-business-primary, #3964fe);background:var(--dsw-alias-state-business-primary, #3964fe);color:#fff}" +
      ".__sm_status{font-size:12px;color:var(--dsw-alias-label-tertiary)}" +
      ".__sm_error{font-size:12px;color:var(--dsw-alias-state-error-primary)}" +
      ".__sm_unavailable{font-size:13px;color:var(--dsw-alias-label-tertiary)}" +
      ".__sm_group{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}" +
      ".__sm_roster{display:flex;flex-direction:row;flex-wrap:wrap;gap:6px}" +
      ".__sm_chip{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 10px;font-size:11px}" +
      ".__sm_chipReg{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}" +
      ".__sm_switch{display:inline-flex;align-items:center;gap:6px;font-size:12px;margin-right:8px}" +
      ".__sm_switchLabel{color:var(--dsw-alias-label-tertiary);white-space:nowrap}" +
      ".__sm_switchSelect{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:3px 6px;font:inherit;font-size:12px;max-width:180px}";
    var tagId = "dsh-soul-md/main.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-soul-md";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ── locale ────────────────────────────────────────────────────────────
    var NS = "soulMd";
    var inject = ["slots", "locale", "settingsScope"];
    var zh = {
      nav: "人设卡",
      intro: "soul.md 风格人设 + 长期记忆：人设按 会话选择 → 工作区卡片 → 全局 三级解析，会话中途切换即时生效；记忆按 角色/工作区/全局 三级存储。修改配置后即时生效。",
      fallbackHint: "文件缺失/不可读时使用的文本；留空则不注册段落。",
      orderHint: "段落顺序；0 渲染在部署 persona 之后。",
      completeHint: "把渲染结果作为完整系统提示词（高级）。",
      watchHint: "（v0.4 起段落按次组装解析，此开关为兼容保留）",
      save: "保存",
      reset: "恢复默认",
      saved: "已保存",
      saving: "保存中…",
      error: "保存失败",
      unavailable: "设置命名空间不可用（服务端未注册 soul-md 命名空间？）",
      overridden: "已覆盖",
      loading: "加载中…",
      personasTitle: "多人设（会话选择 > 工作区卡片 > 全局）",
      personasIntro: "在聊天框标题栏可以直接切换当前会话的人设；以下配置决定可选卡片与解析规则。",
      personasDirHint: "人设注册表目录（放多张 *.md 人设卡）；绝对路径，或相对 dsh home；留空则不启用注册表。",
      personasWorkspaceHint: "工作区人设卡文件名（放在会话工作区目录下）。",
      rosterTitle: "可选人设",
      rosterHint: "由服务端扫描注册表目录生成；在聊天框标题栏切换。",
      memoryTitle: "长期记忆（角色/工作区/全局三级）",
      memoryPathHint: "全局记忆文件；绝对路径，或相对全局 soul.md 所在目录。",
      memoryWorkspaceHint: "工作区记忆文件名（放在会话工作区目录下）。",
      memoryInjectHint: "把记忆文件渲染为 soul:memory 提示词段落（AI 可随时读到记忆）。",
      memoryMaxCharsHint: "注入段落的字符上限（从文件开头截取；超出的部分用 memory_read 读取全文）。",
      soulMaxBytesHint: "soul_update 工具允许写入的最大字节数（防止人设卡被写爆）。",
      memoryIntro: "AI 用 memory_append / memory_read / memory_rewrite 读写当前作用域的记忆，用 soul_read / soul_update 演化当前生效的人设卡——让它自己\u201c成长\u201d。",
      switchLabel: "人设",
      switchTitle: "切换当前会话的人设（会话级，优先于工作区/全局）"
    };
    var en = {
      nav: "Persona Card",
      intro: "soul.md-style persona + long-term memory: persona resolves per session (session choice > workspace card > global) and switches apply from the next turn; memory is scoped by persona/workspace/global. Edits apply immediately.",
      fallbackHint: "Text used when the resolved card is missing/unreadable; empty means no section.",
      orderHint: "Prompt section order; 0 renders after the deployment persona slot.",
      completeHint: "Treat the rendered card as the complete system prompt (advanced).",
      watchHint: "(v0.4 resolves sections per assembly; this switch is kept for compatibility)",
      save: "Save",
      reset: "Reset",
      saved: "Saved",
      saving: "Saving…",
      error: "Save failed",
      unavailable: "Settings namespace unavailable (soul-md namespace not registered server-side?)",
      overridden: "overridden",
      loading: "Loading…",
      personasTitle: "Multi-persona (session choice > workspace card > global)",
      personasIntro: "Switch the current session's persona from the conversation header; these options control the available cards and resolution.",
      personasDirHint: "Persona registry directory (one *.md card per persona); absolute, or relative to dsh home; empty disables the roster.",
      personasWorkspaceHint: "Workspace persona card filename (inside the session's workspace).",
      rosterTitle: "Available personas",
      rosterHint: "Scanned by the host from the registry directory; switch from the conversation header.",
      memoryTitle: "Long-term memory (persona / workspace / global scopes)",
      memoryPathHint: "Global memory file; absolute, or relative to the global soul.md directory.",
      memoryWorkspaceHint: "Workspace memory filename (inside the session's workspace).",
      memoryInjectHint: "Also render the memory file as the soul:memory prompt section (the agent always sees its memory).",
      memoryMaxCharsHint: "Cap for the injected section (chars, from the file head); use memory_read for the full text.",
      soulMaxBytesHint: "Max bytes soul_update may write to the persona card.",
      memoryIntro: "The AI reads/writes its current memory scope with memory_append / memory_read / memory_rewrite and evolves its active persona with soul_read / soul_update — so it can \"grow\" on its own.",
      switchLabel: "Persona",
      switchTitle: "Switch this session's persona (session-level, overrides workspace/global)"
    };

    var FIELDS = [
      { key: "path", label: "全局 soul.md 路径（绝对，或相对 dsh home）", type: "text" },
      { key: "fallback", label: "缺失时回退文本", type: "textarea" },
      { key: "order", label: "段落顺序", type: "number" },
      { key: "complete", label: "作为完整系统提示词", type: "checkbox" },
      { key: "watch", label: "文件变更热重载（兼容）", type: "checkbox" },
      { key: "debounceMs", label: "重载防抖（毫秒，兼容）", type: "number" },
      { key: "soulMaxBytes", label: "soul_update 最大字节", type: "number" }
    ];
    var PERSONA_FIELDS = [
      { key: "dir", label: "人设注册表目录", type: "text", hint: "personasDirHint" },
      { key: "workspaceFile", label: "工作区人设卡文件名", type: "text", hint: "personasWorkspaceHint" }
    ];
    var MEMORY_FIELDS = [
      { key: "path", label: "全局记忆文件", type: "text", hint: "memoryPathHint" },
      { key: "workspaceFile", label: "工作区记忆文件名", type: "text", hint: "memoryWorkspaceHint" },
      { key: "inject", label: "注入为 soul:memory 提示词段落", type: "checkbox", hint: "memoryInjectHint" },
      { key: "injectMaxChars", label: "注入字符上限", type: "number", hint: "memoryMaxCharsHint" }
    ];
    var GROUPS = { personas: PERSONA_FIELDS, memory: MEMORY_FIELDS };
    var GROUP_DEFAULTS = {
      personas: { dir: "", workspaceFile: ".dsh-persona.md" },
      memory: { path: "memory.md", workspaceFile: ".dsh-memory.md", inject: true, injectMaxChars: 8000 }
    };
    var HINTS = { fallback: "fallbackHint", order: "orderHint", complete: "completeHint", watch: "watchHint", soulMaxBytes: "soulMaxBytesHint" };

    function SoulSection(props) {
      var t = props.t;
      var scope = props.scope;
      var [snapshot, setSnapshot] = react.useState(function () { return scope.getSnapshot(); });
      var ready = snapshot.status === "ready" && snapshot.value !== void 0;
      var [draft, setDraft] = react.useState({});
      var [busy, setBusy] = react.useState(false);
      var [notice, setNotice] = react.useState(null);
      var [error, setError] = react.useState(null);

      react.useEffect(function () {
        scope.load();
        var alive = true;
        var sync = function () { if (alive) setSnapshot(scope.getSnapshot()); };
        var un = typeof scope.subscribe === "function" ? scope.subscribe(sync) : null;
        return function () { alive = false; if (un) un(); if (scope.dispose) scope.dispose(); };
      }, [scope]);
      // Seed the draft ONLY when the snapshot becomes ready — never on value
      // churn. settingsScope.getSnapshot() returns a fresh object per call,
      // so depending on snapshot.value would reset user input on every render
      // (typing appears dead).
      react.useEffect(function () {
        if (ready) setDraft(Object.assign({}, valueToDraft(snapshot.value)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [ready]);

      if (snapshot.status === "unavailable") {
        return h("p", { className: "__sm_unavailable" }, t("unavailable"));
      }
      if (!ready) return h("p", { className: "__sm_status" }, t("loading"));

      var value = snapshot.value;
      var user = snapshot.user || {};

      function fieldDraft(f) {
        if (f.type === "checkbox") return draft[f.key] !== void 0 ? draft[f.key] : Boolean(value[f.key]);
        return draft[f.key] !== void 0 ? draft[f.key] : String(value[f.key] ?? "");
      }
      function setField(f, v) {
        setDraft(function (prev) { var next = Object.assign({}, prev); next[f.key] = v; return next; });
        setNotice(null);
        setError(null);
      }

      // Nested groups (personas / memory): edited as whole objects.
      function groupDraft(name, f) {
        var g = draft[name] || {};
        var base = value[name] || {};
        var def = GROUP_DEFAULTS[name] || {};
        if (f.type === "checkbox") return g[f.key] !== void 0 ? g[f.key] : Boolean(base[f.key] ?? def[f.key]);
        return g[f.key] !== void 0 ? g[f.key] : String(base[f.key] ?? def[f.key]);
      }
      function setGroupField(name, f, v) {
        setDraft(function (prev) {
          var next = Object.assign({}, prev);
          var g = Object.assign({}, prev[name] || {});
          g[f.key] = v;
          next[name] = g;
          return next;
        });
        setNotice(null);
        setError(null);
      }
      function groupNext(name) {
        var g = draft[name] || {};
        var base = value[name] || {};
        var def = GROUP_DEFAULTS[name] || {};
        var out = {};
        GROUPS[name].forEach(function (f) {
          var cur = g[f.key] !== void 0 ? g[f.key] : (base[f.key] ?? def[f.key]);
          out[f.key] = f.type === "checkbox" ? Boolean(cur) : (f.type === "number" ? Number(cur) : String(cur));
        });
        return out;
      }
      function groupBase(name) {
        var base = value[name] || {};
        var def = GROUP_DEFAULTS[name] || {};
        var out = {};
        GROUPS[name].forEach(function (f) {
          var cur = base[f.key] ?? def[f.key];
          out[f.key] = f.type === "checkbox" ? Boolean(cur) : (f.type === "number" ? Number(cur) : String(cur));
        });
        return out;
      }

      function onSave() {
        setBusy(true); setNotice(null); setError(null);
        var groupPromises = Object.keys(GROUPS).map(function (name) {
          var next = groupNext(name);
          var base = groupBase(name);
          return JSON.stringify(next) === JSON.stringify(base) ? Promise.resolve() : scope.set(name, next);
        });
        Promise.all(FIELDS.map(function (f) {
          var d = fieldDraft(f);
          if (f.type === "checkbox") {
            if (Boolean(d) === Boolean(value[f.key])) return Promise.resolve();
            return Boolean(d) ? scope.set(f.key, true) : scope.unset(f.key);
          }
          if (String(d) === String(value[f.key] ?? "")) return Promise.resolve();
          return String(d).trim() === "" ? scope.unset(f.key) : scope.set(f.key, f.type === "number" ? Number(d) : d);
        }).concat(groupPromises)).then(function () {
          setBusy(false); setNotice(t("saved"));
          if (scope.load) scope.load();
        }).catch(function (e) {
          setBusy(false); setError(t("error") + ": " + String(e && e.message || e));
        });
      }

      function reseedDraft() {
        if (typeof scope.load === "function") {
          var p = scope.load();
          if (p && typeof p.then === "function") {
            p.then(function () {
              var fresh = scope.getSnapshot();
              if (fresh.status === "ready" && fresh.value !== void 0) setDraft(Object.assign({}, valueToDraft(fresh.value)));
            }).catch(function () {});
            return;
          }
        }
        setTimeout(function () {
          var fresh = scope.getSnapshot();
          if (fresh.status === "ready" && fresh.value !== void 0) setDraft(Object.assign({}, valueToDraft(fresh.value)));
        }, 120);
      }

      function onReset() {
        setBusy(true); setNotice(null); setError(null);
        Promise.all(FIELDS.map(function (f) { return scope.unset(f.key); }).concat(Object.keys(GROUPS).map(function (name) { return scope.unset(name); }))).then(function () {
          setBusy(false); setNotice(t("saved"));
          reseedDraft();
        }).catch(function (e) {
          setBusy(false); setError(t("error") + ": " + String(e && e.message || e));
        });
      }

      function renderGroup(name, titleKey, introKey, extra) {
        return h("div", { className: "__sm_group" },
          h("p", { className: "__sm_label", style: { margin: 0 } }, t(titleKey)),
          h("p", { className: "__sm_hint", style: { margin: "0 0 2px" } }, t(introKey)),
          GROUPS[name].map(function (f) {
            if (f.type === "checkbox") {
              return h("label", { key: f.key, className: "__sm_field" },
                h("span", { className: "__sm_row" },
                  h("input", { className: "__sm_check", type: "checkbox", checked: Boolean(groupDraft(name, f)), onChange: function (e) { setGroupField(name, f, e.target.checked); } }),
                  h("span", { className: "__sm_label" }, f.label)
                ),
                f.hint ? h("span", { className: "__sm_hint" }, t(f.hint)) : null
              );
            }
            return h("label", { key: f.key, className: "__sm_field" },
              h("span", { className: "__sm_label" }, f.label),
              h("input", { className: "__sm_input", type: f.type === "number" ? "number" : "text", value: groupDraft(name, f), onChange: function (e) { setGroupField(name, f, e.target.value); } }),
              f.hint ? h("span", { className: "__sm_hint" }, t(f.hint)) : null
            );
          }),
          extra ? extra : null
        );
      }

      var roster = Array.isArray(value.roster) ? value.roster : [];

      return h("div", { className: "__sm_root" },
        h("p", { className: "__sm_hint", style: { margin: "0 0 4px" } }, t("intro")),
        FIELDS.map(function (f) {
          var overridden = f.key in user;
          if (f.type === "checkbox") {
            return h("label", { key: f.key, className: "__sm_field" },
              h("span", { className: "__sm_row" },
                h("input", { className: "__sm_check", type: "checkbox", checked: Boolean(fieldDraft(f)), onChange: function (e) { setField(f, e.target.checked); } }),
                h("span", { className: "__sm_label" }, f.label),
                overridden ? h("span", { className: "__sm_override" }, t("overridden")) : null
              ),
              f.key in HINTS ? h("span", { className: "__sm_hint" }, t(HINTS[f.key])) : null
            );
          }
          return h("label", { key: f.key, className: "__sm_field" },
            h("span", { className: "__sm_label" },
              f.label,
              overridden ? h("span", { className: "__sm_override" }, t("overridden")) : null
            ),
            f.type === "textarea"
              ? h("textarea", { className: "__sm_input __sm_textarea", value: fieldDraft(f), onChange: function (e) { setField(f, e.target.value); } })
              : h("input", { className: "__sm_input", type: f.type === "number" ? "number" : "text", value: fieldDraft(f), onChange: function (e) { setField(f, e.target.value); } }),
            f.key in HINTS ? h("span", { className: "__sm_hint" }, t(HINTS[f.key])) : null
          );
        }),
        renderGroup("personas", "personasTitle", "personasIntro",
          h("div", { className: "__sm_field" },
            h("span", { className: "__sm_label" }, t("rosterTitle")),
            h("span", { className: "__sm_hint" }, t("rosterHint")),
            h("div", { className: "__sm_roster" },
              roster.length > 0
                ? roster.map(function (r) {
                    return h("span", { key: r.key || "auto", className: "__sm_chip" + (r.kind === "registry" ? " __sm_chipReg" : "") }, r.label);
                  })
                : h("span", { className: "__sm_hint" }, "—")
            )
          )
        ),
        renderGroup("memory", "memoryTitle", "memoryIntro"),
        h("div", { className: "__sm_actions" },
          h("button", { type: "button", className: "__sm_btn __sm_btnPrimary", onClick: onSave, disabled: busy || !snapshot.writable }, t("save")),
          h("button", { type: "button", className: "__sm_btn", onClick: onReset, disabled: busy || !snapshot.writable }, t("reset")),
          notice ? h("span", { className: "__sm_status" }, notice) : null,
          busy ? h("span", { className: "__sm_status" }, t("saving")) : null,
          error ? h("span", { className: "__sm_error" }, error) : null
        )
      );
    }

    function valueToDraft(value) {
      var out = {};
      for (var i = 0; i < FIELDS.length; i += 1) {
        var f = FIELDS[i];
        out[f.key] = f.type === "checkbox" ? Boolean(value[f.key]) : String(value[f.key] ?? "");
      }
      Object.keys(GROUPS).forEach(function (name) {
        var g = value[name] || {};
        var def = GROUP_DEFAULTS[name] || {};
        out[name] = {};
        GROUPS[name].forEach(function (f) {
          var cur = g[f.key] ?? def[f.key];
          out[name][f.key] = f.type === "checkbox" ? Boolean(cur) : String(cur);
        });
      });
      return out;
    }

    // ── per-session persona switcher (conversation header) ──────────────────
    function PersonaSwitcher(props) {
      var t = props.t;
      var scope = props.scope;
      var sessionId = props.sessionId;
      var [snapshot, setSnapshot] = react.useState(function () { return scope.getSnapshot(); });
      react.useEffect(function () {
        scope.load();
        var alive = true;
        var sync = function () { if (alive) setSnapshot(scope.getSnapshot()); };
        var un = typeof scope.subscribe === "function" ? scope.subscribe(sync) : null;
        return function () { alive = false; if (un) un(); if (scope.dispose) scope.dispose(); };
      }, [scope]);
      var ready = snapshot.status === "ready" && snapshot.value !== void 0;
      if (!ready || !sessionId) return null;
      var value = snapshot.value;
      var roster = Array.isArray(value.roster) ? value.roster : [];
      var sessions = value.sessions && typeof value.sessions === "object" ? value.sessions : {};
      var choice = sessions[sessionId] || "";
      if (choice && !roster.some(function (r) { return r.key === choice; })) {
        roster = roster.concat([{ key: choice, label: choice, kind: "stale" }]);
      }
      function onChange(e) {
        var v = e.target.value;
        var next = Object.assign({}, sessions);
        if (v === "") delete next[sessionId];
        else next[sessionId] = v;
        scope.set("sessions", next).then(function () {
          if (scope.load) scope.load();
        }).catch(function () {});
      }
      return h("label", { className: "__sm_switch", title: t("switchTitle") },
        h("span", { className: "__sm_switchLabel" }, t("switchLabel")),
        h("select", { className: "__sm_switchSelect", value: choice, onChange: onChange },
          roster.map(function (r) {
            return h("option", { key: r.key || "auto", value: r.key }, r.label);
          })
        )
      );
    }

    // ── plugin ────────────────────────────────────────────────────────────
    function apply(ctx) {
      var t = ctx.locale.bind(NS);
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "dsh-soul-md: dictionaries");
      var sectionScope = ctx.settingsScope.bind({ namespace: "soul-md" });
      var switchScope = ctx.settingsScope.bind({ namespace: "soul-md" });
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "soul-md",
          order: 24,
          label: function () { return t("nav"); },
          locale: NS
        }, function (props) {
          return h(SoulSection, Object.assign({}, props, { scope: sectionScope }));
        });
      });
      ctx.slots.inject("conversation.session.header.actions", function () {
        return ctx.slots.register({
          name: "conversation.session.header.actions",
          id: "soul-md-persona",
          order: 40
        }, function (props) {
          return h(PersonaSwitcher, Object.assign({}, props, { scope: switchScope, t: t }));
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
