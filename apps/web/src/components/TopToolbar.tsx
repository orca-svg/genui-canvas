import { useId, type ChangeEvent, type FormEvent } from "react";
import { Toolbar } from "@base-ui/react/toolbar";
import { ListTree, Redo2, RefreshCw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

export interface TopToolbarProps {
  scenarios: Array<{ label: string }>;
  onScenario: (label: string) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  persona: string;
  personas: Array<{ id: string; label: string }>;
  onPersonaChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  pendingCount: number;
  canRecompose: boolean;
  onRecompose: () => void;
  showCardList: boolean;
  cardListOpen: boolean;
  onToggleCardList: () => void;
}

/**
 * One-line toolbar: composition points on the left, history and 재구성 on the
 * right. Buttons keep a native `disabled` (Base UI's toolbar default is
 * focusable-when-disabled, which only sets aria-disabled), matching every
 * other shell control.
 */
export function TopToolbar(p: TopToolbarProps) {
  const pendingId = useId();
  const pending = p.pendingCount > 0;
  return (
    <Toolbar.Root className="toolbar" aria-label="구성 도구">
      <Toolbar.Group className="toolbar__group toolbar__group--scenarios" aria-label="시나리오">
        {p.scenarios.map((scenario) => (
          <Toolbar.Button
            key={scenario.label}
            focusableWhenDisabled={false}
            render={<Button type="button" variant="outline" size="sm" />}
            disabled={p.disabled}
            onClick={() => p.onScenario(scenario.label)}
          >
            {scenario.label}
          </Toolbar.Button>
        ))}
      </Toolbar.Group>
      <form className="toolbar__query" onSubmit={p.onSubmit}>
        <label htmlFor="benefit-query" className="toolbar__label">
          혜택 검색
        </label>
        <Toolbar.Input
          id="benefit-query"
          name="benefit-query"
          type="search"
          autoComplete="off"
          maxLength={300}
          aria-describedby="benefit-query-hint"
          placeholder="예: 부산 청년 창업 지원…"
          value={p.query}
          onChange={(event) => p.onQueryChange(event.target.value)}
        />
        <Toolbar.Button render={<Button type="submit" size="sm" />} focusableWhenDisabled={false} disabled={p.disabled}>
          혜택 찾기
        </Toolbar.Button>
        <span id="benefit-query-hint" className="toolbar__hint">
          이름·주민번호·연락처 등 개인식별정보는 입력하지 마세요. 최대 300자입니다.
        </span>
      </form>
      <div className="toolbar__persona">
        <label htmlFor="persona" className="toolbar__label">
          추천 관점
        </label>
        <select
          id="persona"
          name="persona"
          value={p.persona}
          disabled={p.disabled}
          onChange={p.onPersonaChange}
          // Not a roving-focus item: the toolbar must not turn its arrow keys into a focus jump.
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") event.stopPropagation();
          }}
        >
          {p.personas.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <Toolbar.Separator className="toolbar__separator" />
      <Toolbar.Group className="toolbar__group toolbar__group--history" aria-label="조작 이력">
        <Tooltip label="마지막 카드 조작을 취소">
          <Toolbar.Button
            render={<Button type="button" variant="ghost" size="sm" />}
            focusableWhenDisabled={false}
            disabled={p.disabled || !p.canUndo}
            onClick={p.onUndo}
          >
            <Undo2 aria-hidden="true" />
            실행 취소
          </Toolbar.Button>
        </Tooltip>
        <Tooltip label="취소한 조작을 다시 적용">
          <Toolbar.Button
            render={<Button type="button" variant="ghost" size="sm" />}
            focusableWhenDisabled={false}
            disabled={p.disabled || !p.canRedo}
            onClick={p.onRedo}
          >
            <Redo2 aria-hidden="true" />
            다시 실행
          </Toolbar.Button>
        </Tooltip>
        <Tooltip label="대기 중인 조작을 반영해 추천을 다시 구성">
          <Toolbar.Button
            render={<Button type="button" size="sm" />}
            className="toolbar__recompose"
            focusableWhenDisabled={false}
            aria-describedby={pending ? pendingId : undefined}
            disabled={p.disabled || !p.canRecompose}
            onClick={p.onRecompose}
          >
            <RefreshCw aria-hidden="true" />
            조작 반영해 재구성
            {pending && (
              <span className="toolbar__badge" aria-hidden="true">
                {p.pendingCount}
              </span>
            )}
          </Toolbar.Button>
        </Tooltip>
        {/* The badge is decorative; the count reaches screen readers as the button's description. */}
        {pending && (
          <span id={pendingId} className="sr-only">
            대기 조작 {p.pendingCount}개
          </span>
        )}
        {p.showCardList && (
          <Toolbar.Button
            render={<Button type="button" variant="outline" size="sm" />}
            aria-label="카드 목록"
            aria-expanded={p.cardListOpen}
            aria-controls="edge-drawer"
            onClick={p.onToggleCardList}
          >
            <ListTree aria-hidden="true" />
            카드 목록
          </Toolbar.Button>
        )}
      </Toolbar.Group>
    </Toolbar.Root>
  );
}
