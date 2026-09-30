import { useEffect, useRef } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HiddenRowNotice({ title, onUndo, busy = false }: { title: string; onUndo: () => void; busy?: boolean }) {
  const undoRef = useRef<HTMLButtonElement>(null);
  // Hiding removes the control that held focus, so hand focus to 되돌리기: the
  // in-place undo is only reachable by keyboard if it is where focus lands.
  useEffect(() => {
    undoRef.current?.focus();
  }, []);
  return (
    <div className="hidden-notice" role="status" aria-label="숨김 안내" data-testid="hidden-notice">
      <span>{title}을 숨겼습니다 · 카드 목록에서 다시 볼 수 있습니다.</span>
      <Button ref={undoRef} type="button" variant="outline" size="sm" disabled={busy} onClick={onUndo}>
        <Undo2 aria-hidden="true" />
        되돌리기
      </Button>
    </div>
  );
}
