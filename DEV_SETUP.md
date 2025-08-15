# 开发环境设置

## 自动部署到 Obsidian

为了方便开发和测试，项目支持自动将构建后的插件文件部署到你的 Obsidian 库中。

### 设置步骤

1. **复制环境变量文件**
   ```bash
   cp .env.example .env
   ```

2. **配置你的 Obsidian 库路径**
   编辑 `.env` 文件，设置 `OBSIDIAN_VAULT_PATH` 为你的 Obsidian 库路径：
   
   **Windows 示例：**
   ```
   OBSIDIAN_VAULT_PATH=C:\Users\YourName\Documents\MyVault
   ```
   
   **macOS/Linux 示例：**
   ```
   OBSIDIAN_VAULT_PATH=/Users/yourname/Documents/MyVault
   ```

3. **构建并部署**
   ```bash
   npm run build
   ```
   
   这将：
   - 编译 TypeScript 代码
   - 构建插件文件
   - 自动复制 `main.js`、`manifest.json`、`styles.css` 到你的 Obsidian 插件目录

### 可用脚本

- `npm run build` - 构建并自动部署到 Obsidian
- `npm run build-only` - 仅构建，不部署
- `npm run deploy` - 仅部署（需要先构建）
- `npm run dev` - 开发模式构建

### 部署路径

插件将被部署到：
```
{OBSIDIAN_VAULT_PATH}/.obsidian/plugins/obsidian-rapid-notes/
```

### 注意事项

- 如果未配置 `OBSIDIAN_VAULT_PATH`，构建仍会正常进行，只是不会自动部署
- 部署后可能需要在 Obsidian 中重新加载插件或重启 Obsidian
- `.env` 文件已添加到 `.gitignore`，不会被提交到 git 仓库
