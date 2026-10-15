import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Home, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui'

interface Props {
  /** 出错时展示的上下文名（例如「数据」「音源」），用于让用户知道是哪一页炸了 */
  label?: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 页面级错误边界：把「一个页面的渲染异常」限制在这一个页面内。
 *
 *  【为什么必须有这个东西（不是锦上添花）】
 *  本应用此前**没有任何 ErrorBoundary**。React 18 的行为是：渲染期抛出的异常
 *  如果没人接，就卸载**整棵** root 树。实测（Playwright 打线上 NAS）：
 *  点「设置 → 数据」触发 `(l ?? []).map is not a function` 之后，
 *  连底部导航栏都从 DOM 里消失了 —— 页面变成纯白，且**之后点任何导航按钮都还是白的**，
 *  因为已经没有 DOM 可点了，只能刷新。
 *  于是「一个页面的小 bug」被放大成「整个应用不可用」，用户报告的现象就是
 *  「点数据白屏」+「移动端导航栏点了也白屏」—— 其实是同一个根因。
 *
 *  【为什么 fallback 里要给「返回首页」而不只是「重试」】
 *  「重试」只是清掉 error 重新渲染；如果崩溃条件仍在（例如接口一直返回坏数据），
 *  会立刻再炸一次，用户会觉得按钮没用。所以同时给一条明确的逃生路径。
 *  另外 Shell 里给本组件挂了 `key={pathname}`：换路由会重建边界，
 *  等于「点别的导航就能自动恢复」，这条路径不需要用户点重试。 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 保留 componentStack：白屏类问题唯一的现场线索，缺了它只能靠猜。
    console.error('[ErrorBoundary] 页面渲染崩溃:', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="rise mx-auto mt-6 w-full max-w-lg rounded-2xl border border-line bg-panel p-5 shadow-card">
        <span className="flex size-9 items-center justify-center rounded-lg bg-danger/10 text-danger">
          <AlertTriangle className="size-4" />
        </span>
        <h2 className="mt-3 text-base font-semibold text-ink">
          {this.props.label ? `「${this.props.label}」这一页出错了` : '这一页出错了'}
        </h2>
        <p className="mt-1 text-sm text-dim">
          其他页面不受影响，可以直接从导航栏切走。下面是给开发者看的错误详情。
        </p>
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-line bg-panel2 p-3 font-mono text-[11px] leading-relaxed text-danger">
          {error.message || String(error)}
        </pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={this.reset}>
            <RotateCcw className="size-4" /> 重试
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { window.location.href = '/' }}>
            <Home className="size-4" /> 返回首页
          </Button>
        </div>
      </div>
    )
  }
}
