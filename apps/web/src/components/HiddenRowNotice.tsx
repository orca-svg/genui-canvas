import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HiddenRowNotice({ title, onUndo }: { title: string; onUndo: () => void }) {
  return (
    <div className="hidden-notice" role="status" aria-label="숨김 안내" data-testid="hidden-notice">
      <span>{title}을 숨겼습니다 · 카드 목록에서 다시 볼 수 있습니다.</span>
      <Button type="button" variant="outline" size="sm" onClick={onUndo}>
        <Undo2 aria-hidden="true" />
        되돌리기
      </Button>
    </div>
  );
}
