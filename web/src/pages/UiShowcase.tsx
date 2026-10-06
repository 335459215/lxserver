import { useState } from 'react'
import { Info, Settings, Trash2 } from 'lucide-react'
import {
  Button,
  Collapse,
  CollapseContent,
  CollapseItem,
  CollapseTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  HStack,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  Stack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
} from '@/components/ui'

/** 组件库展示页（活文档）：11 件 Radix 组件的真实行为验证。
 * 阶段 B 起挂在 /dev，作为统一外壳/设置中心的组件参照 */
export default function UiShowcase() {
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [quality, setQuality] = useState('flac')
  return (
    <div className="w-full max-w-lg rounded-2xl border border-line bg-panel p-6 shadow-pop">
      <h2 className="text-base font-semibold">组件库展示</h2>
      <p className="mt-1 text-xs text-dim">
        11 件 Radix 组件的真实行为验证，统一外壳与设置中心直接取用
      </p>
      <Tabs defaultValue="base" className="mt-4">
        <TabsList>
          <TabsTrigger value="base">基础</TabsTrigger>
          <TabsTrigger value="feedback">反馈</TabsTrigger>
          <TabsTrigger value="nav">导航</TabsTrigger>
        </TabsList>

        <TabsContent value="base" className="space-y-4">
          <HStack gap={2} className="flex-wrap">
            <Button onClick={() => toast({ title: '默认按钮', description: 'variant=default' })}>
              默认
            </Button>
            <Button variant="secondary">次要</Button>
            <Button variant="outline">描边</Button>
            <Button variant="ghost">幽灵</Button>
            <Button variant="destructive">危险</Button>
          </HStack>
          <Stack gap={1}>
            <label className="text-xs text-dim" htmlFor="demo-input">
              Input
            </label>
            <Input
              id="demo-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入点什么…"
            />
          </Stack>
          <Stack gap={1}>
            <span className="text-xs text-dim">Select</span>
            <Select value={quality} onValueChange={setQuality}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flac">无损 FLAC</SelectItem>
                <SelectItem value="320k">320kbps</SelectItem>
                <SelectItem value="128k">128kbps</SelectItem>
              </SelectContent>
            </Select>
          </Stack>
        </TabsContent>

        <TabsContent value="feedback" className="space-y-4">
          <HStack gap={2} className="flex-wrap">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">打开 Dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>确认操作</DialogTitle>
                  <DialogDescription>这是 Radix Dialog 的标准内容区。</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">取消</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button onClick={() => toast({ title: '已确认', variant: 'success' })}>
                      确认
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">打开 Sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>侧滑面板</SheetTitle>
                  <SheetDescription>移动端会大量用到的抽屉形态。</SheetDescription>
                </SheetHeader>
                <SheetClose asChild>
                  <Button variant="secondary" className="mt-4 w-full">
                    收起
                  </Button>
                </SheetClose>
              </SheetContent>
            </Sheet>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="关于">
                    <Info />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Tooltip 提示</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </HStack>
          <HStack gap={2}>
            <Button
              variant="secondary"
              onClick={() => toast({ title: '普通提示', description: '4 秒自动消失，可右滑关闭' })}
            >
              Toast 默认
            </Button>
            <Button
              variant="destructive"
              onClick={() => toast({ title: '失败示例', description: 'destructive 变体', variant: 'destructive' })}
            >
              Toast 危险
            </Button>
          </HStack>
        </TabsContent>

        <TabsContent value="nav" className="space-y-4">
          <Menu>
            <MenuTrigger asChild>
              <Button variant="outline">
                <Settings /> 下拉菜单
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => toast({ title: '菜单项一' })}>重新扫描</MenuItem>
              <MenuItem onSelect={() => toast({ title: '菜单项二' })}>导出配置</MenuItem>
              <MenuSeparator />
              <MenuItem
                className="text-danger focus:text-danger"
                onSelect={() => toast({ title: '删除', variant: 'destructive' })}
              >
                <Trash2 /> 删除
              </MenuItem>
            </MenuContent>
          </Menu>
          <Collapse type="single" collapsible>
            <CollapseItem value="c1">
              <CollapseTrigger>可折叠分区（设置中心将用它）</CollapseTrigger>
              <CollapseContent>组内内容的折叠区，阶段 B 的九宫格 → Tab 分组会直接复用。</CollapseContent>
            </CollapseItem>
            <CollapseItem value="c2">
              <CollapseTrigger>第二个分区</CollapseTrigger>
              <CollapseContent>动画由 tailwindcss-animate + Radix 高度变量驱动。</CollapseContent>
            </CollapseItem>
          </Collapse>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SheetHeader({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>
}
