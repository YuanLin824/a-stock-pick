const fs = require('fs')
const path = require('path')

// 提交范围（scope）= 项目根下的功能目录（自动扫描，目录变动无需改配置）
// 排除隐藏目录（.claude/.codegraph 等）、依赖与缓存目录
const SCOPE_EXCLUDE = new Set(['node_modules', 'logs', 'dist', 'build'])
const scopes = fs
  .readdirSync(__dirname, { withFileTypes: true })
  .filter((dirent) => {
    return dirent.isDirectory() && !dirent.name.startsWith('.') && !SCOPE_EXCLUDE.has(dirent.name)
  })
  .map((dirent) => dirent.name)

const TYPE_ENUM = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'chore',
  'revert',
  'build',
  'ci',
  'types',
]

/** @type {import('czg').UserConfig} */
module.exports = {
  ignores: [(commit) => commit === 'init'],
  extends: ['@commitlint/config-conventional'],
  rules: {
    // https://commitlint.js.org/reference/rules.html
    'type-enum': [2, 'always', TYPE_ENUM],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'scope-empty': [0],
    'subject-case': [2, 'never'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never'],
    'header-max-length': [2, 'always', 100],
  },
  prompt: {
    messages: {
      type: '选择提交类型:',
      scope: '选择提交范围 [不需要时, 请选择 empty]:',
      customScope: '请输入自定义提交范围:',
      subject: '填写简短变更描述:',
      body: '填写详细变更描述 [可选]; 使用 | 换行:',
      breaking: '列举非兼容性重大变更 [可选]; 使用 | 换行:',
      footerPrefixsSelect: '选择关联 issue 前缀 [可选]: ',
      customFooterPrefixs: '输入自定义 issue 前缀:',
      footer: '列举关联 issue [可选]; 例如: #31, #I3244:',
      confirmCommit: '是否提交或修改 commit ?',
    },
    types: [
      { value: 'feat', name: '✨ 特性: [功能新增]', emoji: '✨' },
      { value: 'fix', name: '🐛 修复: [bug 修复]', emoji: '🐛' },
      { value: 'docs', name: '📝 文档: [文档变更]', emoji: '📝' },
      { value: 'style', name: '🎨 格式: [代码格式化; 不影响功能]', emoji: '🎨' },
      { value: 'refactor', name: '🎃 重构: [代码重构; 不影响功能]', emoji: '🎃' },
      { value: 'perf', name: '🐎 性能: [性能优化]', emoji: '🐎' },
      { value: 'test', name: '✅ 测试: [测试更改]', emoji: '✅' },
      { value: 'chore', name: '🔨 其他: [辅助工具和库的更改]', emoji: '🔨' },
      { value: 'revert', name: '⏪ 回退: [回滚 commit]', emoji: '⏪' },
      { value: 'build', name: '📦️ 构建: [构建流程更改]', emoji: '📦️' },
      { value: 'ci', name: '🍀 集成: [CI 配置, 脚本更改]', emoji: '🍀' },
      { value: 'types', name: '🏡 类型: [类型文件更改]', emoji: '🏡' },
    ],
    useEmoji: true,
    scopes: [...scopes],
    emptyScopesAlias: 'empty',
    customScopesAlias: 'custom',
    customScopesAlign: 'top-bottom',
    allowBreakingChanges: ['feat', 'fix'],
  },
}
