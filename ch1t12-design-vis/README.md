# ch1t12-design-vis · 原 SVG 模板驱动可视化

两张设计师 SVG 画板就是实际界面，不再由前端仿画。Vue 3 保存当前视图、实体与年份；D3 把 SVG 内已有的文字和图形槽位绑定到 ch1t12 的真实实体、关系、编制、时间点与辞典原文。

## 数据与设计源

- 结构化数据：`data/database/song_bureaucracy_entries_ch1t12.db`（只读）
- 辞典原文：`data/database/song_bureaucracy_dictionary_ch1t12.db`（只读）
- 层级画板：`svg格式/宋代职官体系可视化界面_画板 1 副本 4-01.svg`
- 编制画板：`svg格式/宋代职官体系可视化界面_画板 1 副本 4-02.svg`
- 字体直接读取设计包内 `FZQingKBYSJW-M.TTF` 与 `AdobeSongStd-Light.otf`

## 实现原则

- 标题、机构分类、说明框、机构节点、官职槽位、编制矩形、时间线、图例和纸纹全部来自原 SVG。
- 前端不重新绘制这些模块，只替换 SVG 文字槽位并绑定交互。
- 点击 SVG 中能匹配数据库的机构或官职，会在原说明框内写入当前年份的真实时间点、编制和下级机构。
- 层级画板保留两个机构级入口：右上角开书图标在当前层级图中就地展开编制关系；先选中机构后，右下角开书图标进入完整编制画板。完整画板只绘制进入时机构及其下级机构的编制数据，顶栏“层级视图”用于返回，不能从顶栏脱离具体机构直接进入。
- 完整编制画板沿用原4-02的连续镶嵌语法：焦点机构的3px总框包住整图，左栏放大号竖排标题与直属编制；有下级的直属机构成为2px部门块，块内只排列直接下级，更深机构嵌套在自己的父列中；无下级的焦点直属机构合入一个附属列带，不升级成孤立大卡。每条宏观横带和部门内部行都会重新配宽填满，机构列保留约2px细缝；中心编制只使用原稿8px/7px竖排文字，不额外添加图例方块。
- 五大机构分类与层级画板共用同一份选中状态；进入编制画板不会重新分类或切换类别。
- 时间轴只选择单年，单击或拖动都移动原 SVG 三角指针。选中年份后显示该年的“年末快照”：机构/官职的存废状态沿时间链持续累积，明确设置或恢复时进入，明确罢废时退出，普通记载只更新详情而不把已经罢废的实体自动复活。上下级和编制关系取截至该年最近一次归属；年代未明不混入具体年份快照。点击“× 取消选择”恢复历时全貌。

## 技术栈

- Vue 3：状态与数据加载
- D3.js：SVG DOM 数据绑定、年份映射和交互
- Vite：前端构建
- Python 标准库：SQLite 数据 API、旁路版本工作区与原设计资源服务

## 人工修订与版本

- 系统默认只读；右上角“进入修改”显式开启时间点和“前后演变”关系校订。
- 草稿保存在与结果库同名的 `*.revisions.db`，刷新页面后仍保留，不会改变正式四表或 `/api/data` 指纹。
- 每项人工修改必须填写理由并关联已有引用，或填写新出处和逐字引文。链指针、依赖引用和 `NormalizedTimes` 刷新作为同一操作组的自动联动保存。
- 草稿预览只返回受影响时间点、关系、引用和年份补丁；前端增量应用，不重新下载完整 `/api/data`。
- 提交时使用 SQLite `ATTACH + BEGIN IMMEDIATE` 同事务更新结果库和版本库，并在提交前刷新唯一的 `latest-rollback` 应急检查点。
- 历史恢复采用反向提交，不删除已有提交；外部脚本改变正式库后，工作区会锁定并拒绝自动合并。

## 启动

```bash
cd vis/ch1t12-design-vis
./run.sh
```

默认地址：`http://127.0.0.1:8650/`

`node_modules` 与 legacy 项目共用，不要在本目录运行 `pnpm install`。

## 主要文件

```text
server.py
src/App.vue
src/components/DesignTemplateCanvas.vue
```

## 接口

- `/api/data`：ch1t12 实体、时间点、层级关系、编制关系、引用和辞典原文
- `/api/revisions/state`：当前 HEAD、草稿游标和编辑锁
- `/api/revisions/draft/operations|preview|undo|redo|discard`：持久草稿及增量预览
- `/api/revisions/commit`：原子提交当前草稿
- `/api/revisions/commits[/<hash>]`：线性提交历史与逐项差异
- `DELETE /api/revisions/commits/<hash>`：撤销并永久删除当前最新提交；基线、中间提交或草稿非空时拒绝
- `/api/revisions/restore-preview|restore`：预览并创建恢复提交
- `/api/revisions/normalize-time`：只解析原文纪年，不写数据库
- `/api/design/hierarchy.svg`：原始可编辑层级画板
- `/api/design/composition.svg`：原始可编辑编制画板
- `/api/design/*.ttf|otf`：设计包字体
- `/api/health`：服务状态

## 当前边界

- SVG 中已有的示例机构名称会按数据库同名实体绑定；设计稿没有预留槽位的额外实体不会凭空新增图形。
- 辞典按实体标题精确匹配，标题不一致的实体可能暂时没有辞典正文。
