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

  it("renders cards in the layout order, not the message order", async () => {
    const { container } = render(
      <CanvasSurfaces messages={twoCards} layout={[{ cardId: "card-2" }, { cardId: "card-1" }]} />,
    );
    await screen.findByText("둘째");
    const ids = [...container.querySelectorAll(".genui-canvas-card")].map((el) =>
      el.getAttribute("data-card-id"),
    );
    expect(ids).toEqual(["card-2", "card-1"]);
  });

  it("omits cards missing from the layout (hidden)", async () => {
    const { container } = render(
      <CanvasSurfaces messages={twoCards} layout={[{ cardId: "card-1" }]} />,
    );
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
        layout={[{ cardId: "card-1", expanded: true }, { cardId: "card-2", expanded: false }]}
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

  it("exposes emphasis on the card wrapper for styling", async () => {
    const { container } = render(
      <CanvasSurfaces messages={benefitCardMessages} layout={[{ cardId: "card-1", emphasis: "primary" }]} />,
    );
    // Text's markdown renderer resolves asynchronously; await it (as the other
    // tests in this file do) so the update lands inside act() before asserting.
    await screen.findByText("국가장학금");
    expect(container.querySelector('[data-card-id="card-1"]')?.getAttribute("data-emphasis")).toBe("primary");
  });
});
