import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { basicCatalog } from "@a2ui/react/v0_9";
import { CanvasSurfaces, createProcessor } from "./index.js";

// A benefit card composed from A2UI primitives (Approach A): the server's
// expand.ts will emit exactly this shape from a "BenefitCard" CardSpec.
const benefitCardMessages = [
  { version: "v0.9", createSurface: { surfaceId: "card-1", catalogId: basicCatalog.id } },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "card-1",
      components: [
        { id: "root", component: "Column", children: ["title", "provider", "summary"] },
        { id: "title", component: "Text", text: { path: "/title" } },
        { id: "provider", component: "Text", text: { path: "/provider" } },
        { id: "summary", component: "Text", text: { path: "/summary" } },
      ],
    },
  },
  {
    version: "v0.9",
    updateDataModel: {
      surfaceId: "card-1",
      path: "/",
      value: { title: "국가장학금", provider: "한국장학재단", summary: "대학생 등록금 지원" },
    },
  },
];

// Two independent one-Text surfaces, "a" and "b", for grouping tests.
function twoSurfaces() {
  const surface = (surfaceId: string, text: string) => [
    { version: "v0.9", createSurface: { surfaceId, catalogId: basicCatalog.id } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId,
        components: [{ id: "root", component: "Text", text: { path: "/t" } }],
      },
    },
    { version: "v0.9", updateDataModel: { surfaceId, path: "/", value: { t: text } } },
  ];
  return [...surface("a", "에이"), ...surface("b", "비")];
}

describe("createProcessor", () => {
  it("builds a processor with one surface from createSurface", () => {
    const processor = createProcessor(benefitCardMessages);
    expect(processor.model.surfacesMap.size).toBe(1);
  });
});

describe("CanvasSurfaces", () => {
  it("renders A2UI primitive messages bound to the data model", async () => {
    render(<CanvasSurfaces messages={benefitCardMessages} />);
    expect(await screen.findByText("국가장학금")).toBeInTheDocument();
    expect(await screen.findByText("한국장학재단")).toBeInTheDocument();
    expect(await screen.findByText("대학생 등록금 지원")).toBeInTheDocument();
  });

  it("renders an empty container when there are no surfaces", () => {
    const { container } = render(<CanvasSurfaces messages={[]} />);
    expect(container.querySelector(".genui-canvas-surfaces")?.childElementCount).toBe(0);
  });

  const twoCards = [
    { version: "v0.9", createSurface: { surfaceId: "card-1", catalogId: basicCatalog.id } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "card-1",
        components: [{ id: "root", component: "Text", text: { path: "/t" } }],
      },
    },
    { version: "v0.9", updateDataModel: { surfaceId: "card-1", path: "/", value: { t: "첫째" } } },
    { version: "v0.9", createSurface: { surfaceId: "card-2", catalogId: basicCatalog.id } },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "card-2",
        components: [{ id: "root", component: "Text", text: { path: "/t" } }],
      },
    },
    { version: "v0.9", updateDataModel: { surfaceId: "card-2", path: "/", value: { t: "둘째" } } },
  ];

  const band = (cardId: string, extra: { expanded?: boolean; emphasis?: "primary" | "secondary" } = {}) => ({
    key: `band:${cardId}`,
    kind: "band" as const,
    slots: [{ cardId, column: "band", ...extra }],
  });

  it("renders cards in the group order, not the message order", async () => {
    const { container } = render(
      <CanvasSurfaces messages={twoCards} groups={[band("card-2"), band("card-1")]} />,
    );
    await screen.findByText("둘째");
    const ids = [...container.querySelectorAll(".genui-canvas-card")].map((el) =>
      el.getAttribute("data-card-id"),
    );
    expect(ids).toEqual(["card-2", "card-1"]);
  });

  it("omits cards missing from the groups (hidden)", async () => {
    const { container } = render(<CanvasSurfaces messages={twoCards} groups={[band("card-1")]} />);
    await screen.findByText("첫째");
    const ids = [...container.querySelectorAll(".genui-canvas-card")].map((el) =>
      el.getAttribute("data-card-id"),
    );
    expect(ids).toEqual(["card-1"]);
  });

  it("marks expanded cards via data-expanded", async () => {
    const { container } = render(
      <CanvasSurfaces
        messages={twoCards}
        groups={[band("card-1", { expanded: true }), band("card-2", { expanded: false })]}
      />,
    );
    await screen.findByText("첫째");
    await screen.findByText("둘째");
    const card1 = container.querySelector('[data-card-id="card-1"]');
    const card2 = container.querySelector('[data-card-id="card-2"]');
    expect(card1).toHaveAttribute("data-expanded", "true");
    expect(card1).toHaveAttribute("id", "canvas-card-card-1");
    expect(card2).toHaveAttribute("data-expanded", "false");
    expect(card1?.querySelector(".genui-canvas-card__body")).toBeInTheDocument();
  });

  it("renders surfaces when messages arrive after mount", async () => {
    // The live app mounts with an empty canvas and sets messages only after the
    // first turn resolves. The processor must rebuild on the new messages.
    const { rerender } = render(<CanvasSurfaces messages={[]} />);
    rerender(<CanvasSurfaces messages={benefitCardMessages} />);
    expect(await screen.findByText("국가장학금")).toBeInTheDocument();
  });
});

const personaButtonMessages = [
  { version: "v0.9", createSurface: { surfaceId: "card-1", catalogId: basicCatalog.id } },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "card-1",
      components: [
        { id: "root", component: "Column", children: ["btn"] },
        {
          id: "btn",
          component: "Button",
          child: "label",
          variant: "primary",
          action: { event: { name: "persona.select", context: { personaId: "senior" } } },
        },
        { id: "label", component: "Text", text: { path: "/label" } },
      ],
    },
  },
  { version: "v0.9", updateDataModel: { surfaceId: "card-1", path: "/", value: { label: "시니어" } } },
];

const checklistMessages = [
  { version: "v0.9", createSurface: { surfaceId: "checklist-1", catalogId: basicCatalog.id } },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "checklist-1",
      components: [
        { id: "root", component: "Column", children: ["check-0"] },
        { id: "check-0", component: "CheckBox", label: { path: "/item0Text" }, value: { path: "/checked0" } },
      ],
    },
  },
  {
    version: "v0.9",
    updateDataModel: { surfaceId: "checklist-1", path: "/", value: { item0Text: "재학증명서", checked0: false } },
  },
];

describe("CanvasSurfaces — interactive primitives", () => {
  it("dispatches a server-composed Button action to onAction with its context", async () => {
    const onAction = vi.fn();
    render(<CanvasSurfaces messages={personaButtonMessages} onAction={onAction} />);
    fireEvent.click(await screen.findByRole("button", { name: "시니어" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0]?.[0]).toMatchObject({
      name: "persona.select",
      surfaceId: "card-1",
      sourceComponentId: "btn",
      context: { personaId: "senior" },
    });
  });

  it("reports CheckBox edits on watched paths and accepts shell-owned values back", async () => {
    const onValueChange = vi.fn();
    const watch = [{ surfaceId: "checklist-1", paths: ["/checked0"] }];
    const { rerender } = render(
      <CanvasSurfaces messages={checklistMessages} watch={watch} onValueChange={onValueChange} />,
    );
    const box = (await screen.findByRole("checkbox", { name: "재학증명서" })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onValueChange).toHaveBeenCalledWith({ surfaceId: "checklist-1", path: "/checked0", value: true });
    expect(box.checked).toBe(true);

    rerender(
      <CanvasSurfaces
        messages={checklistMessages}
        watch={watch}
        values={[{ surfaceId: "checklist-1", path: "/checked0", value: false }]}
        onValueChange={onValueChange}
      />,
    );
    expect(((await screen.findByRole("checkbox", { name: "재학증명서" })) as HTMLInputElement).checked).toBe(false);
    // the shell-driven write must not echo back as a user edit
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it("does not echo a shell value supplied together with the watch list, and still reports a real edit once", async () => {
    const onValueChange = vi.fn();
    const watch = [{ surfaceId: "checklist-1", paths: ["/checked0"] }];
    render(
      <CanvasSurfaces
        messages={checklistMessages}
        watch={watch}
        values={[{ surfaceId: "checklist-1", path: "/checked0", value: true }]}
        onValueChange={onValueChange}
      />,
    );
    const box = (await screen.findByRole("checkbox", { name: "재학증명서" })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.click(box);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith({ surfaceId: "checklist-1", path: "/checked0", value: false });
  });

  it("exposes emphasis on the card wrapper for styling", async () => {
    const { container } = render(
      <CanvasSurfaces
        messages={benefitCardMessages}
        groups={[
          {
            key: "band:card-1",
            kind: "band",
            slots: [{ cardId: "card-1", column: "band", emphasis: "primary" }],
          },
        ]}
      />,
    );
    // Text's markdown renderer resolves asynchronously; await it (as the other
    // tests in this file do) so the update lands inside act() before asserting.
    await screen.findByText("국가장학금");
    expect(container.querySelector('[data-card-id="card-1"]')?.getAttribute("data-emphasis")).toBe("primary");
  });
});

describe("CanvasSurfaces — groups, chrome and empty slots", () => {
  it("renders groups in group order with band and row wrappers", async () => {
    render(
      <CanvasSurfaces
        messages={twoSurfaces()}
        rowColumns={["benefit", "score"]}
        groups={[
          { key: "row:x", kind: "row", slots: [{ cardId: "b", column: "benefit" }] },
          { key: "band:a", kind: "band", slots: [{ cardId: "a", column: "band" }] },
        ]}
      />,
    );
    const wrappers = await screen.findAllByTestId(/^group-/);
    expect(wrappers.map((el) => el.dataset.groupKey)).toEqual(["row:x", "band:a"]);
    const row = wrappers[0]!;
    expect(row).toHaveClass("genui-canvas-row");
    expect(row.dataset.columns).toBe("2");
    const cells = Array.from(row.children) as HTMLElement[];
    expect(cells.map((c) => c.dataset.column)).toEqual(["benefit", "score"]);
    expect(cells[0]).toHaveClass("genui-canvas-card");
    expect(cells[1]).toHaveClass("genui-canvas-slot--empty");
  });

  it("renders chrome before the body and empty-slot content in empty cells", async () => {
    render(
      <CanvasSurfaces
        messages={twoSurfaces()}
        rowColumns={["benefit", "score"]}
        groups={[{ key: "row:x", kind: "row", slots: [{ cardId: "a", column: "benefit" }] }]}
        renderChrome={(slot) => <button type="button">{slot.cardId} 고정</button>}
        renderEmptySlot={(column) => <span>{column} 자리</span>}
      />,
    );
    const card = await screen.findByTestId("card-a");
    expect(card.firstElementChild).toContainElement(screen.getByRole("button", { name: "a 고정" }));
    expect(card.lastElementChild).toHaveClass("genui-canvas-card__body");
    expect(screen.getByText("score 자리").closest(".genui-canvas-slot--empty")).not.toBeNull();
  });

  it("lets the shell wrap a group through renderGroup", async () => {
    render(
      <CanvasSurfaces
        messages={twoSurfaces()}
        groups={[{ key: "row:x", kind: "row", slots: [{ cardId: "a", column: "benefit" }] }]}
        renderGroup={(group, content) => <section aria-label={`wrap ${group.key}`}>{content}</section>}
      />,
    );
    expect(await screen.findByRole("region", { name: "wrap row:x" })).toBeInTheDocument();
  });

  it("omits cards absent from every group (hidden) and keeps a missing surface as an empty cell", async () => {
    render(
      <CanvasSurfaces
        messages={twoSurfaces()}
        rowColumns={["benefit", "score"]}
        groups={[
          {
            key: "row:x",
            kind: "row",
            slots: [
              { cardId: "b", column: "benefit" },
              { cardId: "ghost", column: "score" },
            ],
          },
        ]}
      />,
    );
    await screen.findByTestId("card-b");
    expect(screen.queryByTestId("card-a")).toBeNull();
    expect(screen.queryByTestId("card-ghost")).toBeNull();
    expect(document.querySelector('.genui-canvas-slot--empty[data-column="score"]')).not.toBeNull();
  });
});
