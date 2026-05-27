# 指数计算器功能说明书

## 产品能力总览

![产品能力总览](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/doc/assets/产品能力总览.png)

指数计算器是一款面向业务分析场景的桌面工具。它帮助用户把原始数据整理成可计算指标，训练权重模型，生成综合指数与分项结果，并通过图表和解释看板理解结果背后的结构与变化。

它更适合解决这几类问题：

- 一份原始表如何快速变成可计算的数据集
- 多个指标如何形成一个可解释的综合指数
- 哪些一级维度、二级指标在拉动或拖累结果
- 如何把结果导出成适合汇报和复盘的图表与数据

## 1. 用户会怎么使用它

整个产品的主流程非常直接：

1. 导入原始数据
2. 检查并确认指标设置
3. 训练权重模型
4. 生成结果
5. 通过解释型看板理解结果
6. 导出数据和图表

左侧导航对应这条流程：

- 快速开始
- 数据集
- 指标模板
- 权重模型
- 计算
- 结果

## 2. 快速开始

首页承担的是“帮助用户理解产品”的角色，而不是单纯欢迎页。

它会直接展示：

- 三种常用方法的差异
- 每种方法适合怎样解读数据
- 示例图表和结果卡片
- 进入数据集导入与建模流程的入口

![首页](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/01-onboarding.png)

从用户视角看，首页主要回答两个问题：

- 这个产品能做什么
- 我应该如何理解不同计算方法的结果

## 3. 数据集：把原始表变成可计算数据

数据集页是所有业务数据进入系统的入口。

它提供：

- 数据集列表
- 数据导入
- 数据预览
- 指标设置
- 用户数据删除

![数据集列表](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/02-datasets-list.png)

### 3.1 支持两类数据导入

#### 标准宽表

适合已经整理好的业务数据。  
典型字段包括：

- `entity`
- `year`
- 多个指标列

#### 原始一级/二级指标表

适合还保留结构信息的源表。  
例如包含：

- `一级指标`
- `二级指标`
- 多个年份列或目标年份列

系统会自动把这种表识别为“有层级关系的数据”，并在导入时完成：

- 一级/二级关系抽取
- 数据展开
- 指标生成
- 分组补全

用户不需要先手动把它改造成宽表。

![导入弹窗](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/03-import-modal.png)

![导入原始指标表](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/04-import-raw-sheet.png)

### 3.2 导入后能得到什么

导入完成后，用户可以直接看到：

- 数据集是否已经就绪
- 系统识别出了多少可计算指标
- 是否已经自动补全分组和方向

![导入后的数据集](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/05-datasets-after-import.png)

## 4. 指标设置：轻量修正，而不是重做一遍

点击数据集后，可以进入详情抽屉。  
这里最重要的是 **指标设置**。

它解决的是“系统已经帮我识别出来了，但我还想微调”的问题。

用户可以在这里查看和调整：

- 指标 Key
- 显示名称
- 分组
- 正向 / 负向
- 对应数据列

![指标设置](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/06-dataset-indicator-settings.png)

这部分的设计重点不是让用户重新建指标，而是尽量把系统已经识别好的内容透明展示出来，只在必要时做轻量修正。

## 5. 指标模板：增强层，不是前置门槛

指标模板页的定位是“补全语义”，而不是要求用户先维护一套全局指标库。

它主要做三件事：

- 当列名命中模板时，自动补全分组、方向、名称
- 沉淀组织内常用指标口径
- 帮助不同数据集保持更一致的表达方式

![指标模板页](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/11-indicator-templates.png)

当前产品规则是：

- 模板命中则优先使用模板
- 模板未命中则默认正向
- 模板不会阻塞用户完成主流程

## 6. 权重模型：把指标变成可计算的模型

权重模型页负责训练模型。

当前支持：

- 熵权法
- PCA
- AHP

用户在这里需要做的通常只有：

- 选择训练数据集
- 选择方法
- 确认指标集合
- 保存模型

![新建模型表单](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/07-model-train-form.png)

![模型列表](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/08-models-after-train.png)

其中：

- 熵权法和 PCA 更适合快速从数据中得到权重
- AHP 更适合需要人工表达偏好的场景

## 7. 计算：把模型应用到数据

计算页负责把“模型”和“数据集”组合成最终结果。

用户只需要：

- 选择一个权重模型
- 选择一个目标数据集
- 生成结果

![计算表单](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/09-compute-form.png)

产品会自动帮助用户避免常见错误，例如：

- 模型和数据集指标不兼容
- 数据集没有足够可计算指标
- 当前筛选条件下无法继续进入计算

## 8. 结果页：不仅看结果，还解释结果

结果页是产品最核心的分析出口。

它分成 4 层：

1. 结果表格
2. 图表区
3. 解释型分析看板
4. 导出能力

![结果页](/Users/sean/Documents/harness%20practice/projects/indicator-calculator/repo/output/playwright/manual/10-results-dashboard.png)

### 8.1 结果表格

结果表格支持：

- 按实体筛选
- 按年份筛选
- 自定义显示列
- 点击行打开详情

### 8.2 图表区

图表区支持多种视图，例如：

- 时间趋势
- 年度截面
- 同比变化
- 结构雷达
- 热力图
- 散点关系

系统会根据数据形态自动调整默认视角：

- 单实体时序数据，更强调趋势和变化
- 多实体对比数据，更强调横向比较

### 8.3 解释型分析看板

解释型分析看板的重点不是“再放一批图”，而是把结果拆开讲清楚。

它分成 4 个页签：

- 总览
- 一级拆解
- 二级诊断
- 方法解释

#### 总览

帮助用户先快速判断：

- 当前综合指数是多少
- 相比上一期变化多少
- 哪个一级维度最强
- 哪个一级维度最弱

#### 一级拆解

帮助用户理解：

- 哪个一级维度在拉动结果
- 哪个一级维度变化最大
- 一级维度整体趋势如何

#### 二级诊断

帮助用户继续往下追问：

- 是哪些二级指标在影响结果
- 这些影响是短期变化还是长期趋势
- 指标之间是否出现结构性差异

#### 方法解释

帮助用户理解：

- 当前结果采用的是哪种方法
- 哪些指标权重最高
- 这套模型更偏重什么

## 9. 导出能力

结果页提供两类常用导出：

- 下载 CSV
- 导出图表 PNG

其中图表导出支持：

- 当前图表导出
- 批量导出主要图表

适合用于：

- 汇报材料
- 阶段复盘
- 方案对比
- 留档归档
  ![a70077bf8bfbed44d1dda83a24887cd3](/Users/sean/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7hok6nrrjshb22_d09b/temp/RWTemp/2026-04/609a7ff6ea006c929665d600fa5451ce/a70077bf8bfbed44d1dda83a24887cd3.png)![75a9ec582aa2bbc80bc649c163854f24](/Users/sean/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7hok6nrrjshb22_d09b/temp/RWTemp/2026-04/609a7ff6ea006c929665d600fa5451ce/75a9ec582aa2bbc80bc649c163854f24.png)![ee525bf8e71dbcc079427a5f6c97d0c5](/Users/sean/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7hok6nrrjshb22_d09b/temp/RWTemp/2026-04/609a7ff6ea006c929665d600fa5451ce/ee525bf8e71dbcc079427a5f6c97d0c5.png)![d29f27e6b7e74d6c1ffb5a8f276abffc](/Users/sean/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7hok6nrrjshb22_d09b/temp/RWTemp/2026-04/609a7ff6ea006c929665d600fa5451ce/d29f27e6b7e74d6c1ffb5a8f276abffc.png)![9d43f5459c158f381c11e73e5403b577](/Users/sean/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7hok6nrrjshb22_d09b/temp/RWTemp/2026-04/609a7ff6ea006c929665d600fa5451ce/9d43f5459c158f381c11e73e5403b577.png)![9fcc1edd8a51f52375008e0fef318bfb](/Users/sean/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7hok6nrrjshb22_d09b/temp/RWTemp/2026-04/609a7ff6ea006c929665d600fa5451ce/9fcc1edd8a51f52375008e0fef318bfb.png)

## 10. 用户能从中得到什么

从用户视角看，这个产品最直接的价值有四个：

- **更快建模**：原始数据可以直接进入计算流程
- **更清晰解释**：不仅有结果，还有一级和二级解释链
- **更稳定复用**：模板可以复用指标语义，但不强迫前置维护
- **更方便汇报**：图表、表格、解释和导出在同一套界面里完成
