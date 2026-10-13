import { useState } from 'react'
import {
  X,
  Download,
  Share,
  Monitor,
  Smartphone,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui'

interface PwaInstallModalProps {
  open: boolean
  onClose: () => void
}

export default function PwaInstallModal({ open, onClose }: PwaInstallModalProps) {
  const isIOS =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

  const [activeTab, setActiveTab] = useState<'desktop' | 'ios' | 'android'>(
    isIOS ? 'ios' : 'desktop',
  )

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* 弹窗主体 */}
      <div className="rise relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-line/80 bg-panel p-6 shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between pb-4 border-b border-line/60">
          <div className="flex items-center gap-2.5">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
              <Download className="size-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-ink">安装 lxserver 为独立应用</h3>
              <p className="text-xs text-dim">添加到桌面或主屏幕，享受全屏沉浸音乐体验</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-faint hover:bg-panel2 hover:text-ink transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 平台切换 Tab */}
        <div className="mt-4 flex rounded-2xl bg-panel2/80 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('desktop')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all ${
              activeTab === 'desktop'
                ? 'bg-panel text-accent shadow-xs'
                : 'text-dim hover:text-ink'
            }`}
          >
            <Monitor className="size-3.5" />
            <span>电脑桌面 (PC/Mac)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ios')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all ${
              activeTab === 'ios'
                ? 'bg-panel text-accent shadow-xs'
                : 'text-dim hover:text-ink'
            }`}
          >
            <Smartphone className="size-3.5" />
            <span>苹果设备 (iOS)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('android')}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold transition-all ${
              activeTab === 'android'
                ? 'bg-panel text-accent shadow-xs'
                : 'text-dim hover:text-ink'
            }`}
          >
            <Smartphone className="size-3.5" />
            <span>安卓手机 (Android)</span>
          </button>
        </div>

        {/* 说明内容 */}
        <div className="mt-5 space-y-4 text-xs text-ink leading-relaxed">
          {activeTab === 'desktop' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-line/60 bg-panel2/50 p-3.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white font-bold text-[11px]">
                  1
                </span>
                <p>
                  在 <strong>Chrome / Edge</strong> 浏览器中，点击地址栏右侧的
                  <span className="inline-flex items-center mx-1 rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px]">
                    安装应用
                  </span>
                  图标。
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-line/60 bg-panel2/50 p-3.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white font-bold text-[11px]">
                  2
                </span>
                <p>
                  若地址栏无图标，点击浏览器右上角 <strong>「···」</strong> 菜单 →
                  选择 <strong>「保存并分享」或「应用」</strong>。
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-line/60 bg-panel2/50 p-3.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white font-bold text-[11px]">
                  3
                </span>
                <p>
                  点击 <strong>「将网页安装为应用」</strong> 或
                  <strong>「创建快捷方式」</strong> 并勾选
                  <strong>「在窗口中打开」</strong>，即可生成桌面快捷独立客户端！
                </p>
              </div>
            </div>
          )}

          {activeTab === 'ios' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-line/60 bg-panel2/50 p-3.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white font-bold text-[11px]">
                  1
                </span>
                <p>
                  使用 iPhone / iPad 系统的 <strong>Safari 浏览器</strong> 打开本页面。
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-line/60 bg-panel2/50 p-3.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white font-bold text-[11px]">
                  2
                </span>
                <p>
                  点击 Safari 底部居中的 <strong>「分享」</strong> 按钮（方框带向上箭头 <Share className="inline size-3.5 text-accent mx-0.5" />）。
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-line/60 bg-panel2/50 p-3.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white font-bold text-[11px]">
                  3
                </span>
                <p>
                  在弹出菜单中向下滑动，选择 <strong>「添加到主屏幕」</strong>，右上角点击「添加」即可！
                </p>
              </div>
            </div>
          )}

          {activeTab === 'android' && (
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-line/60 bg-panel2/50 p-3.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white font-bold text-[11px]">
                  1
                </span>
                <p>
                  使用 <strong>Chrome</strong> 或主流手机浏览器打开本页面。
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-line/60 bg-panel2/50 p-3.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white font-bold text-[11px]">
                  2
                </span>
                <p>
                  点击浏览器右上角 <strong>「···」</strong> 菜单。
                </p>
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-line/60 bg-panel2/50 p-3.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white font-bold text-[11px]">
                  3
                </span>
                <p>
                  选择 <strong>「安装应用」</strong> 或 <strong>「添加到主屏幕」</strong>，确认后即可在手机桌面独立使用。
                </p>
              </div>
            </div>
          )}

          {/* 局域网 HTTP 安全协议提示 */}
          <div className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3.5 text-amber-900 text-[11px] leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold mb-1 text-amber-800">
              <ShieldAlert className="size-3.5 shrink-0 text-amber-600" />
              <span>局域网内网访问提示</span>
            </div>
            <p>
              根据现代 W3C Web 规范，浏览器的<strong>自动弹出安装提示</strong>要求网站配置 HTTPS 安全协议。通过直接输入局域网 IP（如 http://192.168.x.x）访问时，建议通过上述<strong>「浏览器菜单 → 添加到主屏幕 / 创建快捷方式（窗口打开）」</strong>直接拥有独立无边框应用；若需要开启离线缓存与自动安装，可为群晖配置 HTTPS 反向代理域名。
            </p>
          </div>
        </div>

        {/* 底部关闭 */}
        <div className="mt-6 flex justify-end">
          <Button onClick={onClose} className="rounded-xl px-5 text-xs font-semibold">
            我知道了
          </Button>
        </div>
      </div>
    </div>
  )
}
