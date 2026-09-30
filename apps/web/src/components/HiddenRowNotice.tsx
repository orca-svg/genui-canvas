import { useEffect, useId, useRef } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withParticle } from "@/lib/korean";

export function HiddenRowNotice({ title, onUndo, busy = false }: { title: string; onUndo: () => void; busy?: boolean }) {
  const undoRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();
  // Hiding removes the control that held focus, so hand focus to 되돌리기: the
  // in-place undo is only reachable by keyboard if it is where focus lands.
  useEffect(() => {
    undoRef.current?.focus();
  }, []);
  return (
    <div className="hidden-notice" role="status" aria-label="숨김 안내" data-testid="hidden-notice">
      <span id={messageId}>{withParticle(title, "을/를")} 숨겼습니다 · 카드 목록에서 다시 볼 수 있습니다.</span>
      {/* Focus lands here with no context, so the button carries the sentence it undoes. */}
      <Button
        ref={undoRef}
        type="button"
        variant="outline"
        size="sm"
        aria-describedby={messageId}
        disabled={busy}
        onClick={onUndo}
      >
        <Undo2 aria-hidden="true" />
        되돌리기
      </Button>
    </div>
  );
}
