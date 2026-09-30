import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TopToolbar } from "./TopToolbar.js";

const base = () => ({
  scenarios: [{ label: "서울 거주 대학생" }],
  onScenario: vi.fn(),
  query: "서울",
  onQueryChange: vi.fn(),
  onSubmit: vi.fn((event: { preventDefault: () => void }) => event.preventDefault()),
  persona: "general",
  personas: [{ id: "general", label: "일반" }],
  onPersonaChange: vi.fn(),
  disabled: false,
  canUndo: true,
  canRedo: false,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  pendingCount: 2,
  canRecompose: true,
  onRecompose: vi.fn(),
  showCardList: false,
  cardListOpen: false,
  onToggleCardList: vi.fn(),
});

describe("TopToolbar", () => {
  it("keeps the established control names and shows the pending count as a badge", async () => {
    const props = base();
    render(<TopToolbar {...props} />);
    expect(screen.getByRole("toolbar", { name: "구성 도구" })).toBeInTheDocument();
    expect(screen.getByLabelText("혜택 검색")).toHaveValue("서울");
    expect(screen.getByRole("button", { name: "혜택 찾기" })).toBeEnabled();
    expect(screen.getByLabelText("추천 관점")).toHaveValue("general");
    expect(screen.getByRole("button", { name: "다시 실행" })).toBeDisabled();
    const recompose = screen.getByRole("button", { name: "조작 반영해 재구성" });
    expect(recompose).toHaveTextContent("2");
    await userEvent.click(recompose);
    expect(props.onRecompose).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "카드 목록" })).toBeNull();
  });

  it("leaves the persona select's arrow keys to the select instead of moving toolbar focus", async () => {
    const user = userEvent.setup();
    render(<TopToolbar {...base()} />);
    const persona = screen.getByLabelText("추천 관점");
    persona.focus();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowLeft}");
    expect(persona).toHaveFocus();
  });

  it("hides the badge at zero, disables recompose, and shows the mobile card-list button", () => {
    render(<TopToolbar {...base()} pendingCount={0} canRecompose={false} showCardList={true} />);
    const recompose = screen.getByRole("button", { name: "조작 반영해 재구성" });
    expect(recompose).toBeDisabled();
    expect(recompose.querySelector(".toolbar__badge")).toBeNull();
    expect(screen.getByRole("button", { name: "카드 목록" })).toHaveAttribute("aria-expanded", "false");
  });
});
