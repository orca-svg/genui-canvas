import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
