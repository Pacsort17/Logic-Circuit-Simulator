import { LogicEditor } from "../LogicEditor"
import { Modifier, applyModifierTo, attr, cls, div, img, table, tbody, td, th, thead, tr } from "../htmlgen"

type TutorialTruthTableCell = string | number | boolean | null | undefined

export type TutorialContentBlock =
    | TutorialParagraphBlock
    | TutorialImageBlock
    | TutorialCustomBlock
    | TutorialTruthTableBlock
    | TutorialDoubleTruthTableBlock

export class TutorialParagraphBlock {
    public readonly type = "paragraph"

    public constructor(
        public readonly text: string,
    ) { }
}

export class TutorialImageBlock {
    public readonly type = "image"

    public constructor(
        public readonly src: string,
        public readonly alt?: string,
        public readonly caption?: string,
    ) { }
}

export class TutorialCustomBlock {
    public readonly type = "custom"

    public constructor(
        public readonly render: (editor: LogicEditor) => HTMLElement | Modifier,
    ) { }
}

export class TutorialTruthTableBlock {
    public readonly type = "truthTable"

    public constructor(
        public readonly headers: readonly string[] | (() => readonly string[]),
        public readonly rows: () => TutorialTruthTableCell[][],
    ) { }
}

export class TutorialDoubleTruthTableBlock {
    public readonly type = "doubleTruthTable"

    public constructor(
        public readonly dynamicHeaders: readonly string[] | (() => readonly string[]),
        public readonly dynamicRows: () => TutorialTruthTableCell[][],
        public readonly referenceHeaders: readonly string[] | (() => readonly string[]),
        public readonly referenceRows: () => TutorialTruthTableCell[][],
        public readonly dynamicHighlightedRowIndex?: () => number | undefined,
    ) { }
}

export class TutorialContent {
    public readonly rootElem: HTMLDivElement
    private readonly refreshDynamicBlocks: Array<() => void> = []

    public constructor(private readonly editor: LogicEditor) {
        this.rootElem = div(cls("tutorial-content")).render()
    }

    public setBlocks(blocks: readonly TutorialContentBlock[]) {
        this.rootElem.innerHTML = ""
        this.refreshDynamicBlocks.length = 0

        for (const block of blocks) {
            this.rootElem.appendChild(this.renderBlock(block))
        }
    }

    public refresh() {
        for (const refreshBlock of this.refreshDynamicBlocks) {
            refreshBlock()
        }
    }

    private renderBlock(block: TutorialContentBlock): HTMLElement {
        switch (block.type) {
            case "paragraph":
                return div(cls("tutorial-content-block tutorial-paragraph"), block.text).render()

            case "image":
                return div(cls("tutorial-content-block tutorial-image-block"),
                    img(
                        cls("tutorial-image"),
                        attr("src", block.src),
                        attr("alt", block.alt ?? ""),
                    ),
                    block.caption === undefined
                        ? ""
                        : div(cls("tutorial-image-caption"), block.caption),
                ).render()

            case "custom": {
                const wrapper = div(cls("tutorial-content-block tutorial-custom-block")).render()
                applyModifierTo(wrapper, block.render(this.editor))
                return wrapper
            }

            case "truthTable": {
                const wrapper = div(cls("tutorial-content-block tutorial-truth-table-block")).render()
                const renderTruthTable = () => {
                    const headers = typeof block.headers === "function" ? block.headers() : block.headers
                    wrapper.innerHTML = ""
                    wrapper.appendChild(this.renderTruthTable(headers, block.rows()))
                }
                renderTruthTable()
                this.refreshDynamicBlocks.push(renderTruthTable)
                return wrapper
            }

            case "doubleTruthTable": {
                const wrapper = div(cls("tutorial-content-block tutorial-double-truth-table-block")).render()
                const renderTruthTables = () => {
                    const dynamicHeaders = typeof block.dynamicHeaders === "function" ? block.dynamicHeaders() : block.dynamicHeaders
                    const referenceHeaders = typeof block.referenceHeaders === "function" ? block.referenceHeaders() : block.referenceHeaders
                    wrapper.innerHTML = ""
                    wrapper.appendChild(div(cls("tutorial-double-truth-table"),
                        div(cls("tutorial-truth-table-panel"),
                            div(cls("tutorial-truth-table-title"), "Simulation"),
                            this.renderTruthTable(dynamicHeaders, block.dynamicRows(), block.dynamicHighlightedRowIndex?.()),
                        ),
                        div(cls("tutorial-truth-table-spacer")),
                        div(cls("tutorial-truth-table-panel"),
                            div(cls("tutorial-truth-table-title"), "Référence"),
                            this.renderTruthTable(referenceHeaders, block.referenceRows()),
                        ),
                    ).render())
                }
                renderTruthTables()
                this.refreshDynamicBlocks.push(renderTruthTables)
                return wrapper
            }
        }
    }

    private renderTruthTable(headers: readonly string[], rows: TutorialTruthTableCell[][], highlightedRowIndex?: number): HTMLTableElement {
        return table(cls("tutorial-truth-table"),
            thead(tr(...headers.map(header => th(header)))),
            tbody(...rows.map((row, rowIndex) =>
                tr(
                    rowIndex === highlightedRowIndex ? cls("tutorial-truth-table-current-row") : "",
                    ...row.map(cell => td(this.formatTruthTableCell(cell)))
                )
            )),
        ).render()
    }

    private formatTruthTableCell(cell: TutorialTruthTableCell): string {
        if (cell === null || cell === undefined) {
            return "?"
        }
        if (typeof cell === "boolean") {
            return cell ? "True" : "False"
        }
        return String(cell)
    }
}
