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
});
