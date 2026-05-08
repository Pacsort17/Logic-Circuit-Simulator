// simulator/src/TutorialPalette.ts
import { Component, ComponentState } from "../components/Component"
import { ComponentListChangeReason } from "../ComponentList"
import { GateBase } from "../components/Gate"
import { Input } from "../components/Input"
import { Output } from "../components/Output"
import { LogicEditor } from "../LogicEditor"
import { button, cls, div, input, label, span, type } from "../htmlgen"
import { ComponentTypeInput, ComponentTypeOutput, LogicValue, setVisible } from "../utils"
import { TutorialContent, TutorialContentBlock, TutorialDoubleTruthTableBlock, TutorialHintBlock, TutorialImageBlock, TutorialParagraphBlock, TutorialTruthTableBlock } from "./TutorialContent"

type TutorialComponentMatcher =
    | { componentType: string, name?: string }
    | { gateType: string, inputs?: TutorialComponentMatcher[] }

type TruthTableTestState = "unknown" | "running" | "passed" | "failed"
type DynamicTruthTableCell = string | number

class TutorialObjective {
    public constructor(
        public readonly label: string,
        public readonly isCompleted: () => boolean,
    ) { }
}

class TutorialStep {
    public constructor(
        public readonly content: TutorialContentBlock[],
        public readonly objectives: TutorialObjective[],
    ) { }
}

class TutorialDefinition {
    public constructor(
        public readonly id: string,
        public readonly title: string,
        public readonly description: string,
        public readonly createSteps: () => readonly TutorialStep[],
        public readonly truthTableStepIndex?: number,
        public readonly referenceTruthTableHeaders: readonly string[] = [],
        public readonly referenceTruthTableRows: DynamicTruthTableCell[][] = [],
    ) { }
}

export class TutorialPalette {
    public readonly rootElem: HTMLDivElement
    private readonly content: TutorialContent
    private readonly titleElem: HTMLDivElement
    private readonly nextButton: HTMLButtonElement
    private readonly previousButton: HTMLButtonElement
    private readonly pageCounter: HTMLSpanElement
    private readonly bodyElem: HTMLDivElement
    private readonly checklistElem: HTMLDivElement
    private readonly actionsElem: HTMLDivElement
    private readonly tutorialDefinitions: readonly TutorialDefinition[]
    private activeTutorial: TutorialDefinition | undefined = undefined
    private steps: readonly TutorialStep[] = []
    private currentObjectiveCheckboxes: HTMLInputElement[] = []
    private completionListenerCleanups: Array<() => void> = []
    private readonly manuallyCompletedObjectives = new Set<string>()
    private readonly completedTutorialIds = new Set<string>()
    private readonly manuallyUnlockedTutorialIds = new Set<string>()
    private truthTableTestState: TruthTableTestState = "unknown"
    private truthTableTestIsRunning = false
    private truthTableTestRerunRequested = false
    private truthTableTestRunId = 0
    private dynamicTruthTableHeaders: readonly string[] = ["A", "Y = A̅"]
    private referenceTruthTableHeaders: readonly string[] = ["A", "Y = A̅"]
    private dynamicTruthTableHasInputsAndOutputs = false
    private referenceTruthTableRows: DynamicTruthTableCell[][] = [
        [0, 1],
        [1, 0],
    ]
    private dynamicTruthTableRows: DynamicTruthTableCell[][] = [
        [0, "?"],
        [1, "?"],
    ]
    private dynamicTruthTableHighlightedRowIndex: number | undefined = undefined
    private currentStep = 0

    public constructor(private readonly editor: LogicEditor) {
        const close = span("×", cls("tutorial-close")).render()
        close.addEventListener("click", () => editor.setTutorialPaletteVisible(false))
        close.addEventListener("pointerdown", e => e.stopPropagation())

        this.content = new TutorialContent(editor)
        this.tutorialDefinitions = [
            this.createInverterTutorial(),
            this.createCompoundLogicTutorial(),
            this.createAutonomousLogicTutorial(),
            this.createTwoOutputAutonomousLogicTutorial(),
            this.createPixelTutorial(),
            this.createTwoBitPixelTutorial(),
            this.createTruthTableWarmupTutorial(),
            this.createThreeBitPixelChallengeTutorial(),
        ]

        this.nextButton = button(
            type("button"),
            cls("tutorial-next-button"),
            "Suivant",
        ).render()
        this.nextButton.addEventListener("click", () => this.goToNextStep())

        this.previousButton = button(
            type("button"),
            cls("tutorial-previous-button"),
            "Précédent",
        ).render()
        this.previousButton.addEventListener("click", () => this.goToPreviousStep())

        this.pageCounter = span(cls("tutorial-page-counter")).render()
        this.checklistElem = div(cls("tutorial-checklist")).render()
        this.bodyElem = div(cls("tutorial-body")).render()
        this.titleElem = div(cls("tutorial-title")).render()
        this.actionsElem = div(cls("tutorial-actions"),
            this.previousButton,
            this.pageCounter,
            this.nextButton,
        ).render()

        const heading = div(cls("tutorial-heading"),
            this.titleElem,
            close,
        ).render()
        heading.addEventListener("pointerdown", e => this.startDraggingPalette(e))

        const leftResizeHandle = div(cls("tutorial-resize-handle tutorial-resize-handle-left")).render()
        const rightResizeHandle = div(cls("tutorial-resize-handle tutorial-resize-handle-right")).render()
        leftResizeHandle.addEventListener("pointerdown", e => this.startResizingPalette(e, "left"))
        rightResizeHandle.addEventListener("pointerdown", e => this.startResizingPalette(e, "right"))

        this.rootElem = div(cls("tutorial-palette sim-toolbar-right"),
            leftResizeHandle,
            heading,
            this.bodyElem,
            this.actionsElem,
            rightResizeHandle,
        ).render()

        this.showTutorialMenu()
        setVisible(this.rootElem, false)
        editor.html.canvasContainer.appendChild(this.rootElem)
    }

    public setVisible(visible: boolean) {
        setVisible(this.rootElem, visible)
        if (visible && this.activeTutorial !== undefined) {
            this.startListeningForCompletionChanges()
            this.refreshCompletionState()
        } else {
            this.stopListeningForCompletionChanges()
        }
    }

    private showTutorialMenu() {
        this.stopListeningForCompletionChanges()
        this.activeTutorial = undefined
        this.steps = []
        this.currentStep = 0
        this.currentObjectiveCheckboxes = []
        this.manuallyCompletedObjectives.clear()
        this.content.setBlocks([])
        this.checklistElem.innerHTML = ""
        this.bodyElem.innerHTML = ""
        this.bodyElem.scrollTop = 0
        this.titleElem.textContent = "Tutoriels"
        setVisible(this.actionsElem, false)

        const tutorialItems = this.tutorialDefinitions.map((definition, index) => {
            const isUnlocked = this.isTutorialUnlocked(index)
            const startButton = button(
                type("button"),
                cls("tutorial-menu-start-button"),
                "Démarrer",
            ).render()
            startButton.setAttribute("aria-disabled", String(!isUnlocked))
            startButton.classList.toggle("tutorial-menu-start-button-locked", !isUnlocked)
            startButton.addEventListener("click", e => {
                if (!this.isTutorialUnlocked(index)) {
                    e.preventDefault()
                    return
                }
                this.startTutorial(definition)
            })
            if (!isUnlocked) {
                startButton.title = "Terminez le tutoriel précédent pour débloquer celui-ci."
                startButton.addEventListener("dblclick", e => {
                    e.preventDefault()
                    this.manuallyUnlockedTutorialIds.add(definition.id)
                    this.showTutorialMenu()
                })
            }
            const lockedMessage = isUnlocked ? [] : [
                div(cls("tutorial-menu-item-locked"), "Terminez le tutoriel précédent pour débloquer celui-ci.").render(),
            ]

            return div(cls("tutorial-menu-item"),
                div(cls("tutorial-menu-item-title"), definition.title),
                div(cls("tutorial-menu-item-description"), definition.description),
                ...lockedMessage,
                startButton,
            ).render()
        })
        this.bodyElem.appendChild(div(cls("tutorial-menu"),
            ...tutorialItems,
        ).render())
    }

    private startTutorial(tutorial: TutorialDefinition) {
        this.stopListeningForCompletionChanges()
        this.activeTutorial = tutorial
        this.steps = tutorial.createSteps()
        this.currentStep = 0
        this.manuallyCompletedObjectives.clear()
        this.referenceTruthTableHeaders = tutorial.referenceTruthTableHeaders
        this.referenceTruthTableRows = tutorial.referenceTruthTableRows
        this.resetTruthTableTest()
        this.resetDynamicTruthTableDisplay()
        this.updateDisplayedStep()
        if (this.rootElem.style.display !== "none") {
            this.startListeningForCompletionChanges()
        }
    }

    private goToNextStep() {
        if (this.activeTutorial === undefined) {
            return
        }
        if (this.currentStep === this.steps.length - 1) {
            if (this.isCurrentStepCompleted()) {
                this.completedTutorialIds.add(this.activeTutorial.id)
            }
            this.showTutorialMenu()
        } else if (this.isCurrentStepCompleted()) {
            this.currentStep++
            this.updateDisplayedStep()
        }
    }

    private goToPreviousStep() {
        if (this.activeTutorial === undefined) {
            return
        }
        if (this.currentStep === 0) {
            this.showTutorialMenu()
            return
        }
        this.currentStep--
        this.updateDisplayedStep()
    }

    private startDraggingPalette(e: PointerEvent) {
        if (e.button !== 0) {
            return
        }

        e.preventDefault()

        const container = this.editor.html.canvasContainer
        const containerRect = container.getBoundingClientRect()
        const paletteRect = this.rootElem.getBoundingClientRect()
        const offsetX = e.clientX - paletteRect.left
        const offsetY = e.clientY - paletteRect.top

        const movePaletteTo = (clientX: number, clientY: number) => {
            const maxLeft = Math.max(0, container.clientWidth - this.rootElem.offsetWidth)
            const maxTop = Math.max(0, container.clientHeight - this.rootElem.offsetHeight)
            const left = Math.min(Math.max(0, clientX - containerRect.left - offsetX), maxLeft)
            const top = Math.min(Math.max(0, clientY - containerRect.top - offsetY), maxTop)

            this.rootElem.style.left = `${left}px`
            this.rootElem.style.top = `${top}px`
            this.rootElem.style.right = "auto"
        }

        const handlePointerMove = (moveEvent: PointerEvent) => {
            movePaletteTo(moveEvent.clientX, moveEvent.clientY)
        }

        const stopDragging = () => {
            window.removeEventListener("pointermove", handlePointerMove)
            window.removeEventListener("pointerup", stopDragging)
            window.removeEventListener("pointercancel", stopDragging)
        }

        window.addEventListener("pointermove", handlePointerMove)
        window.addEventListener("pointerup", stopDragging)
        window.addEventListener("pointercancel", stopDragging)
        movePaletteTo(e.clientX, e.clientY)
    }

    private startResizingPalette(e: PointerEvent, edge: "left" | "right") {
        if (e.button !== 0) {
            return
        }

        e.preventDefault()
        e.stopPropagation()

        const container = this.editor.html.canvasContainer
        const containerRect = container.getBoundingClientRect()
        const paletteRect = this.rootElem.getBoundingClientRect()
        const minWidth = 260
        const maxAllowedWidth = Math.max(minWidth, container.clientWidth * 0.8)
        const startLeft = paletteRect.left - containerRect.left
        const startTop = paletteRect.top - containerRect.top
        const startRight = paletteRect.right - containerRect.left
        const startWidth = paletteRect.width
        const startX = e.clientX

        this.rootElem.style.left = `${startLeft}px`
        this.rootElem.style.top = `${startTop}px`
        this.rootElem.style.right = "auto"
        this.rootElem.style.height = ""

        const resizePaletteTo = (clientX: number) => {
            if (edge === "left") {
                const minLeft = Math.max(0, startRight - maxAllowedWidth)
                const maxLeft = Math.min(startRight - minWidth, container.clientWidth - minWidth)
                const left = Math.min(Math.max(minLeft, startLeft + clientX - startX), maxLeft)

                this.rootElem.style.left = `${left}px`
                this.rootElem.style.width = `${startRight - left}px`
                return
            }

            const maxWidth = Math.max(minWidth, Math.min(maxAllowedWidth, container.clientWidth - startLeft))
            const width = Math.min(Math.max(minWidth, startWidth + clientX - startX), maxWidth)

            this.rootElem.style.width = `${width}px`
        }

        const handlePointerMove = (moveEvent: PointerEvent) => {
            resizePaletteTo(moveEvent.clientX)
        }

        const stopResizing = () => {
            window.removeEventListener("pointermove", handlePointerMove)
            window.removeEventListener("pointerup", stopResizing)
            window.removeEventListener("pointercancel", stopResizing)
        }

        window.addEventListener("pointermove", handlePointerMove)
        window.addEventListener("pointerup", stopResizing)
        window.addEventListener("pointercancel", stopResizing)
    }

    private updateDisplayedStep() {
        if (this.activeTutorial === undefined) {
            this.showTutorialMenu()
            return
        }
        this.bodyElem.replaceChildren(this.content.rootElem, this.checklistElem)
        this.titleElem.textContent = this.activeTutorial.title
        setVisible(this.actionsElem, true)
        this.content.setBlocks(this.steps[this.currentStep].content)
        this.bodyElem.scrollTop = 0
        this.pageCounter.textContent = `Etape ${this.currentStep + 1} / ${this.steps.length}`
        this.nextButton.textContent = this.currentStep === this.steps.length - 1 ? "Fermer" : "Suivant"
        this.previousButton.textContent = this.currentStep === 0 ? "Tutoriels" : "Précédent"
        this.renderChecklist()
        this.refreshCompletionState()
        setVisible(this.nextButton, true)
        setVisible(this.previousButton, true)
    }

    private refreshCompletionState() {
        if (this.activeTutorial === undefined) {
            return
        }
        this.scheduleTruthTableTestIfNeeded()

        const step = this.steps[this.currentStep]
        for (let i = 0; i < step.objectives.length; i++) {
            const checkbox = this.currentObjectiveCheckboxes[i]
            const isAutomaticallyCompleted = step.objectives[i].isCompleted()
            const isManuallyCompleted = this.isObjectiveManuallyCompleted(this.currentStep, i)
            checkbox.checked = isAutomaticallyCompleted || isManuallyCompleted
            checkbox.classList.toggle("tutorial-checklist-checkbox-auto", isAutomaticallyCompleted)
            checkbox.classList.toggle("tutorial-checklist-checkbox-manual", !isAutomaticallyCompleted && isManuallyCompleted)
        }
        this.nextButton.disabled = this.currentStep < this.steps.length - 1 && !this.isCurrentStepCompleted()
    }

    private renderChecklist() {
        this.checklistElem.innerHTML = ""
        this.currentObjectiveCheckboxes = []

        const step = this.steps[this.currentStep]
        setVisible(this.checklistElem, step.objectives.length > 0)

        const stepIndex = this.currentStep
        for (let objectiveIndex = 0; objectiveIndex < step.objectives.length; objectiveIndex++) {
            const objective = step.objectives[objectiveIndex]
            const checkbox = input(
                type("checkbox"),
                cls("tutorial-checklist-checkbox"),
            ).render()
            checkbox.addEventListener("change", () => {
                const key = this.objectiveKey(stepIndex, objectiveIndex)
                if (objective.isCompleted()) {
                    this.manuallyCompletedObjectives.delete(key)
                } else if (checkbox.checked) {
                    this.manuallyCompletedObjectives.add(key)
                } else {
                    this.manuallyCompletedObjectives.delete(key)
                }
                this.refreshCompletionState()
            })
            this.currentObjectiveCheckboxes.push(checkbox)

            this.checklistElem.appendChild(label(cls("tutorial-checklist-item"),
                checkbox,
                span(cls("tutorial-checklist-label"), objective.label),
            ).render())
        }
    }

    private startListeningForCompletionChanges() {
        if (this.completionListenerCleanups.length > 0) {
            return
        }
        const refreshCompletionState = (reason: ComponentListChangeReason = "structure") => {
            if (reason === "value") {
                this.updateDynamicTruthTableHighlightedRow()
                this.content.refresh()
                this.refreshCompletionState()
                return
            }
            this.resetTruthTableTest()
            this.refreshCompletionState()
        }
        this.completionListenerCleanups = [
            this.editor.editorRoot.components.addChangeListener(refreshCompletionState),
            this.editor.editorRoot.linkMgr.addChangeListener(refreshCompletionState),
        ]
    }

    private stopListeningForCompletionChanges() {
        for (const cleanup of this.completionListenerCleanups) {
            cleanup()
        }
        this.completionListenerCleanups.length = 0
    }

    private isCurrentStepCompleted(): boolean {
        return this.steps[this.currentStep].objectives.every((objective, objectiveIndex) =>
            objective.isCompleted() || this.isObjectiveManuallyCompleted(this.currentStep, objectiveIndex)
        )
    }

    private isTutorialUnlocked(index: number): boolean {
        const definition = this.tutorialDefinitions[index]
        return (
            index === 0
            || this.completedTutorialIds.has(this.tutorialDefinitions[index - 1].id)
            || this.manuallyUnlockedTutorialIds.has(definition.id)
        )
    }

    private isObjectiveManuallyCompleted(stepIndex: number, objectiveIndex: number): boolean {
        return this.manuallyCompletedObjectives.has(this.objectiveKey(stepIndex, objectiveIndex))
    }

    private objectiveKey(stepIndex: number, objectiveIndex: number): string {
        return `${stepIndex}:${objectiveIndex}`
    }

    private hasValidTruthTable(): boolean {
        return this.truthTableTestState === "passed"
    }

    private hasDynamicTruthTableMatching(headers: readonly string[], rows: DynamicTruthTableCell[][]): boolean {
        if (!this.dynamicTruthTableHasInputsAndOutputs) {
            return false
        }
        if (
            this.dynamicTruthTableHeaders.length !== headers.length
            || this.dynamicTruthTableHeaders.some((header, index) => header !== headers[index])
            || this.dynamicTruthTableRows.length !== rows.length
        ) {
            return false
        }
        return rows.every((row, rowIndex) =>
            row.length === this.dynamicTruthTableRows[rowIndex].length
            && row.every((cell, colIndex) => cell === this.dynamicTruthTableRows[rowIndex][colIndex])
        )
    }

    private resetTruthTableTest() {
        this.truthTableTestState = "unknown"
        this.truthTableTestRunId++
    }

    private resetDynamicTruthTableDisplay() {
        this.dynamicTruthTableHeaders = this.referenceTruthTableHeaders.length > 0
            ? this.referenceTruthTableHeaders
            : ["?"]
        this.dynamicTruthTableRows = this.referenceTruthTableRows.length > 0
            ? this.referenceTruthTableRows.map(row => row.map((cell, index) =>
                index === row.length - 1 ? "?" : cell
            ))
            : [["?"]]
        this.dynamicTruthTableHasInputsAndOutputs = false
        this.dynamicTruthTableHighlightedRowIndex = undefined
        this.content.refresh()
    }

    private scheduleTruthTableTestIfNeeded() {
        if (
            !this.isCurrentStepTruthTableStep()
            || this.truthTableTestState !== "unknown"
        ) {
            return
        }
        if (this.truthTableTestIsRunning) {
            this.truthTableTestRerunRequested = true
            return
        }
        this.runTruthTableTest()
    }

    private isCurrentStepTruthTableStep(): boolean {
        if (this.activeTutorial?.truthTableStepIndex === this.currentStep) {
            return true
        }
        return this.steps[this.currentStep]?.content.some(block => block.type === "doubleTruthTable") ?? false
    }

    private regenerateSimulationTruthTable() {
        this.resetTruthTableTest()
        if (this.truthTableTestIsRunning) {
            this.truthTableTestRerunRequested = true
            return
        }
        this.runTruthTableTest()
    }

    private async runTruthTableTest() {
        const runId = ++this.truthTableTestRunId
        this.truthTableTestState = "running"
        this.truthTableTestIsRunning = true
        this.truthTableTestRerunRequested = false

        try {
            await this.rebuildDynamicTruthTable(runId)
            if (runId !== this.truthTableTestRunId) {
                return
            }

            this.truthTableTestState = this.areTruthTablesEqual() ? "passed" : "failed"
            this.refreshCompletionState()
        } finally {
            this.truthTableTestIsRunning = false
            if (this.truthTableTestRerunRequested) {
                this.runTruthTableTest()
            } else if (runId !== this.truthTableTestRunId) {
                this.refreshCompletionState()
            }
        }
    }

    private async rebuildDynamicTruthTable(runId: number) {
        const inputs = this.placedComponents()
            .filter(comp => this.isInputComponent(comp))
            .sort((a, b) => this.compareTruthTableComponentOrder(a, b))
        const outputs = this.placedComponents()
            .filter(comp => this.isOutputComponent(comp))
            .sort((a, b) => this.compareTruthTableComponentOrder(a, b))

        const inputBits = inputs.flatMap(input =>
            input.value.map((__, bitIndex) => ({ input, bitIndex }))
        )
        const outputBits = outputs.flatMap(output =>
            output.value.map((__, bitIndex) => ({ output, bitIndex }))
        )
        this.dynamicTruthTableHasInputsAndOutputs = inputBits.length > 0 && outputBits.length > 0

        this.dynamicTruthTableHeaders = [
            ...inputBits.map(({ input, bitIndex }) => this.bitDisplayName(input, bitIndex)),
            ...outputBits.map(({ output, bitIndex }) => this.bitDisplayName(output, bitIndex)),
        ]

        if (this.dynamicTruthTableHeaders.length === 0) {
            this.dynamicTruthTableHeaders = ["?"]
            this.dynamicTruthTableRows = [["?"]]
            this.dynamicTruthTableHighlightedRowIndex = undefined
            this.content.refresh()
            return
        }

        const tables = await this.editor.disableUIWhile("Calcul de la table de vérité", async restoreAfter => {
            for (const input of inputs) {
                restoreAfter.set(input, input.value)
            }

            return await this.editor.withTemporaryPropagationDelay(0, async () => {
                const nextDynamicRows: DynamicTruthTableCell[][] = []
                const numRows = 2 ** inputBits.length
                for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
                    const inputValues = new Map<Input, LogicValue[]>()
                    for (const input of inputs) {
                        inputValues.set(input, input.value.map(() => false))
                    }

                    const row: DynamicTruthTableCell[] = []
                    for (let bit = 0; bit < inputBits.length; bit++) {
                        const value = (rowIndex & (1 << (inputBits.length - bit - 1))) !== 0
                        const { input, bitIndex } = inputBits[bit]
                        inputValues.get(input)![bitIndex] = value
                        row.push(value ? 1 : 0)
                    }

                    for (const [input, values] of inputValues) {
                        input.setValue(values)
                    }

                    this.editor.recalcPropagateAndDrawIfNeeded(true)
                    await this.editor.waitForPropagation()

                    for (const { output, bitIndex } of outputBits) {
                        row.push(this.logicValueAsTruthTableCell(output.value[bitIndex]))
                    }
                    nextDynamicRows.push(row)
                }

                return nextDynamicRows
            })
        })

        if (runId !== this.truthTableTestRunId || tables === undefined) {
            return
        }

        this.dynamicTruthTableRows = tables
        this.updateDynamicTruthTableHighlightedRow()
        this.content.refresh()
    }

    private updateDynamicTruthTableHighlightedRow() {
        const inputBits = this.truthTableInputBits()
        let rowIndex = 0
        for (const { input, bitIndex } of inputBits) {
            const value = input.value[bitIndex]
            if (value !== false && value !== true) {
                this.dynamicTruthTableHighlightedRowIndex = undefined
                return
            }
            rowIndex = rowIndex * 2 + (value ? 1 : 0)
        }
        this.dynamicTruthTableHighlightedRowIndex = inputBits.length === 0 ? undefined : rowIndex
    }

    private areTruthTablesEqual(): boolean {
        if (!this.dynamicTruthTableHasInputsAndOutputs) {
            return false
        }
        if (this.referenceTruthTableRows.length !== this.dynamicTruthTableRows.length) {
            return false
        }
        for (let rowIndex = 0; rowIndex < this.referenceTruthTableRows.length; rowIndex++) {
            const referenceRow = this.referenceTruthTableRows[rowIndex]
            const dynamicRow = this.dynamicTruthTableRows[rowIndex]
            if (referenceRow.length !== dynamicRow.length) {
                return false
            }
            for (let colIndex = 0; colIndex < referenceRow.length; colIndex++) {
                if (referenceRow[colIndex] !== dynamicRow[colIndex]) {
                    return false
                }
            }
        }
        return true
    }

    private hasPlacedComponent(componentType: string): boolean {
        return this.placedComponents().some(comp => comp.def.type === componentType)
    }

    private hasInputNamed(name: string): boolean {
        return this.placedComponents().some(comp =>
            this.isInputComponent(comp) && comp.name === name
        )
    }

    private hasInputValue(name: string, value: LogicValue): boolean {
        return this.placedComponents().some(comp =>
            this.isInputComponent(comp) && comp.name === name && comp.value.length === 1 && comp.value[0] === value
        )
    }

    private hasOutputNamed(name: string): boolean {
        return this.placedComponents().some(comp =>
            this.isOutputComponent(comp) && comp.name === name
        )
    }

    private hasPlacedGate(gateType: string): boolean {
        return this.placedComponents().some(comp => comp instanceof GateBase && comp.type === gateType)
    }

    private hasPlacedGateCount(gateType: string, count: number): boolean {
        return this.placedComponents()
            .filter(comp => comp instanceof GateBase && comp.type === gateType)
            .length >= count
    }

    private hasPlacedGateTotalCount(count: number): boolean {
        return this.placedComponents()
            .filter(comp => comp instanceof GateBase)
            .length === count
    }

    private hasNoPlacedComponents(): boolean {
        return this.placedComponents().length === 0
    }

    private hasOnlyNamedInputsAndOutputs(inputNames: readonly string[], outputNames: readonly string[]): boolean {
        const components = this.placedComponents()
        const inputs = components.filter(comp => this.isInputComponent(comp))
        const outputs = components.filter(comp => this.isOutputComponent(comp))
        return (
            inputs.length === inputNames.length
            && outputs.length === outputNames.length
            && inputs.length + outputs.length === components.length
            && inputNames.every(name => inputs.some(input => input.name === name))
            && outputNames.every(name => outputs.some(output => output.name === name))
        )
    }

    private hasPlacedComponentMatching(matcher: TutorialComponentMatcher): boolean {
        return this.placedComponents().some(comp => this.matchesComponent(comp, matcher))
    }

    private hasPlacedWireBetween(from: TutorialComponentMatcher, to: TutorialComponentMatcher): boolean {
        for (const wire of this.editor.editorRoot.linkMgr.wires) {
            const startComponent = wire.startNode.component
            const endComponent = wire.endNode.component
            if (
                this.matchesComponent(startComponent, from)
                && this.matchesComponent(endComponent, to)
            ) {
                return true
            }
        }
        return false
    }

    private hasPlacedWireFromInputToComponentInput(inputName: string, componentType: string, inputNodeName: string): boolean {
        for (const wire of this.editor.editorRoot.linkMgr.wires) {
            const startComponent = wire.startNode.component
            const endComponent = wire.endNode.component
            const endNode = wire.endNode
            if (
                this.isInputComponent(startComponent)
                && startComponent.name === inputName
                && endComponent.def.type === componentType
                && (endNode.idName === inputNodeName || endNode.group?.name === inputNodeName)
            ) {
                return true
            }
        }
        return false
    }

    private hasPlacedWireFromComponentToComponentInput(from: TutorialComponentMatcher, componentType: string, inputNodeName: string): boolean {
        for (const wire of this.editor.editorRoot.linkMgr.wires) {
            const startComponent = wire.startNode.component
            const endComponent = wire.endNode.component
            const endNode = wire.endNode
            if (
                this.matchesComponent(startComponent, from)
                && endComponent.def.type === componentType
                && (endNode.idName === inputNodeName || endNode.group?.name === inputNodeName)
            ) {
                return true
            }
        }
        return false
    }

    private hasPlacedWireToComponentInput(componentType: string, inputNodeName: string): boolean {
        for (const wire of this.editor.editorRoot.linkMgr.wires) {
            const endComponent = wire.endNode.component
            const endNode = wire.endNode
            if (
                endComponent.def.type === componentType
                && (endNode.idName === inputNodeName || endNode.group?.name === inputNodeName)
            ) {
                return true
            }
        }
        return false
    }

    private hasGateWithIncomingWireCountFromInput(gateType: string, inputName: string, count: number): boolean {
        return this.placedComponents().some(comp => {
            if (!(comp instanceof GateBase) || comp.type !== gateType) {
                return false
            }
            const incomingWires = comp.inputs._all.flatMap(input =>
                input.incomingWire === null ? [] : [input.incomingWire]
            )
            return incomingWires.filter(wire =>
                this.isInputComponent(wire.startNode.component) && wire.startNode.component.name === inputName
            ).length >= count
        })
    }

    private hasIncomingWiresFrom(component: Component, matchers: readonly TutorialComponentMatcher[], visitedComponents: Set<Component>): boolean {
        const incomingWires = component.inputs._all.flatMap(input =>
            input.incomingWire === null ? [] : [input.incomingWire]
        )
        return matchers.every(matcher =>
            incomingWires.some(wire =>
                this.matchesComponent(wire.startNode.component, matcher, new Set(visitedComponents))
            )
        )
    }

    private logicValueAsTruthTableCell(value: LogicValue): DynamicTruthTableCell {
        if (value === false) {
            return 0
        }
        if (value === true) {
            return 1
        }
        return "?"
    }

    private truthTableInputBits(): Array<{ input: Input, bitIndex: number }> {
        return this.placedComponents()
            .filter(comp => this.isInputComponent(comp))
            .sort((a, b) => this.componentDisplayName(a).localeCompare(this.componentDisplayName(b)))
            .flatMap(input => input.value.map((__, bitIndex) => ({ input, bitIndex })))
    }

    private bitDisplayName(component: Input | Output, bitIndex: number): string {
        const name = this.componentDisplayName(component)
        return component.numBits === 1 ? name : `${name}[${bitIndex}]`
    }

    private componentDisplayName(component: Input | Output): string {
        return typeof component.name === "string" && component.name.length > 0
            ? component.name
            : component.ref ?? "?"
    }

    private compareTruthTableComponentOrder(a: Input | Output, b: Input | Output): number {
        const nameA = this.componentDisplayName(a)
        const nameB = this.componentDisplayName(b)
        const referenceIndexA = this.referenceTruthTableHeaders.indexOf(nameA)
        const referenceIndexB = this.referenceTruthTableHeaders.indexOf(nameB)
        if (referenceIndexA !== -1 && referenceIndexB !== -1) {
            return referenceIndexA - referenceIndexB
        }
        if (referenceIndexA !== -1) {
            return -1
        }
        if (referenceIndexB !== -1) {
            return 1
        }
        return nameA.localeCompare(nameB)
    }

    private placedComponents(): Component[] {
        return [...this.editor.editorRoot.components.all()]
            .filter(comp => comp.state === ComponentState.SPAWNED)
    }

    private isInputComponent(component: Component): component is Input {
        return component.def.type === ComponentTypeInput
    }

    private isOutputComponent(component: Component): component is Output {
        return component.def.type === ComponentTypeOutput
    }

    private matchesComponent(component: Component, matcher: TutorialComponentMatcher, visitedComponents: Set<Component> = new Set()): boolean {
        if (component.state !== ComponentState.SPAWNED) {
            return false
        }
        if ("componentType" in matcher) {
            if (component.def.type !== matcher.componentType) {
                return false
            }
            if (matcher.name !== undefined) {
                return (
                    (this.isInputComponent(component) || this.isOutputComponent(component))
                    && component.name === matcher.name
                )
            }
            return true
        }
        if (!(component instanceof GateBase) || component.type !== matcher.gateType) {
            return false
        }
        if (matcher.inputs === undefined) {
            return true
        }
        if (visitedComponents.has(component)) {
            return false
        }
        visitedComponents.add(component)
        return this.hasIncomingWiresFrom(component, matcher.inputs, visitedComponents)
    }

    private createInverterTutorial(): TutorialDefinition {
        const referenceTruthTableHeaders: readonly string[] = ["A", "Y = A̅"]
        const referenceTruthTableRows: DynamicTruthTableCell[][] = [
            [0, 1],
            [1, 0],
        ]

        return new TutorialDefinition(
            "inverter",
            "Dessinez le circuit Y = A̅",
            "Dessinez votre premier circuit logique !",
            () => [
                new TutorialStep([
                    new TutorialParagraphBlock('Bienvenue dans le simulateur logique "Logic" !'),
                    new TutorialParagraphBlock("Il vous permet de dessiner des circuits logiques en plaçant des entrées, des portes logiques, des sorties, puis en les reliant avec des fils."),
                    new TutorialParagraphBlock("Dans ce tutoriel, vous allez construire le circuit correspondant à la fonction logique Y = A̅."),
                    new TutorialParagraphBlock('Cliquez sur "Suivant" pour commencer.'),
                ], []),
                new TutorialStep([
                    new TutorialParagraphBlock('Les composants se trouvent dans la barre située à gauche du simulateur. L’entrée logique correspond au composant "in".'),
                    new TutorialImageBlock("simulator/img/Input1.svg", "Symbole d’entrée", "Entrée"),
                    new TutorialParagraphBlock('Cliquez sur l\'icône pour en faire apparaître une sur le canevas.'),
                    new TutorialParagraphBlock("Vous pouvez ensuite déplacer cette entrée (cliquez dessus et maintenez le clic enfoncé durant le déplacement)."),
                    new TutorialParagraphBlock('Pour renommer l’entrée, cliquez dessus avec deux doigts, sélectionnez le menu "Ajouter un nom...". Nommez cette entrée "A".'),
                ], [
                    new TutorialObjective('Placer une entrée', () => this.hasPlacedComponent(ComponentTypeInput)),
                    new TutorialObjective('Renommer l’entrée en "A"', () => this.hasInputNamed("A")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Ajoutez maintenant la porte logique Non. Elle s’appelle "Non" et se trouve dans la partie "Portes" de la barre de gauche.'),
                    new TutorialImageBlock("simulator/img/not.svg", "Porte logique NON", "Porte non"),
                    new TutorialParagraphBlock('Cliquez sur la porte "Not" pour la faire apparaître, puis déplacez-la à droite de l’entrée A.'),
                    new TutorialParagraphBlock("Pour relier l’entrée à la porte, cliquez sur le point situé à droite de l’entrée, maintenez le clic, puis amenez le fil qui apparaît jusqu’au point situé à gauche de la porte Non."),
                ], [
                    new TutorialObjective('Placer une porte non', () => this.hasPlacedGate("not")),
                    new TutorialObjective('Relier l’entrée A à la porte non', () => this.hasPlacedWireBetween(
                        { componentType: ComponentTypeInput },
                        { gateType: "not" },
                    )),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Il arrive régulièrement de faire des erreurs !"),
                    new TutorialParagraphBlock("Pour supprimer un élément, sélectionnez-le sur le canevas, puis appuyez sur la touche Backspace, celle qui se trouve au-dessus de la touche Entrée sur le clavier."),
                    new TutorialParagraphBlock("Pour cette étape, supprimez la porte Non que vous venez d’ajouter."),
                ], [
                    new TutorialObjective("Supprimer la porte non", () => !this.hasPlacedGate("not")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Le simulateur propose plusieurs outils pour vous aider à dessiner des circuits logiques, trouvables dans la barre en haut du simulateur."),
                    new TutorialParagraphBlock('"Annuler/Rétablir" permet d’annuler la dernière action ou de rétablir une action qui vient d’être annulée.'),
                    new TutorialParagraphBlock('"Concevoir" permet de revenir au mode normal pour créer, déplacer et modifier les composants du circuit.'),
                    new TutorialParagraphBlock('"Supprimer" permet de passer en mode suppression : cliquez ensuite sur un composant ou un fil pour le supprimer.'),
                    new TutorialParagraphBlock('L’icône avec quatre flèches tout à droite permet de déplacer tout le circuit.'),
                    new TutorialParagraphBlock('Le nombre à droite correspond au zoom : changez ce nombre pour agrandir ou réduire l’affichage du circuit.'),
                    new TutorialParagraphBlock('Manipulez ces différents outils pour voir leurs effets, et utilisez "Undo" pour annuler la suppression de la porte non.'),
                ], [
                    new TutorialObjective('Remettre une porte non', () => this.hasPlacedGate("not")),
                    new TutorialObjective('Relier l’entrée A à la porte non', () => this.hasPlacedWireBetween(
                        { componentType: ComponentTypeInput },
                        { gateType: "not" },
                    )),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Ajoutez maintenant une sortie : le composant se nomme "out" et se trouve lui aussi dans la barre de gauche. Placez cette sortie à droite de la porte Non.'),
                    new TutorialImageBlock("simulator/img/Output1.svg", "Symbole de sortie", "Sortie"),
                    new TutorialParagraphBlock('Renommez la sortie en cliquant dessus avec deux doigts, puis en sélectionnant "Ajouter un nom...". Nommez cette sortie "Y".'),
                    new TutorialParagraphBlock("Enfin, reliez la porte Non à la sortie Y (cliquez sur le point situé à droite de la porte Non et maintenez le clic pendant le déplacement pour créer le fil et l'amener jusqu’au point situé à gauche de la sortie Y)."),
                ], [
                    new TutorialObjective('Placer une sortie', () => this.hasPlacedComponent(ComponentTypeOutput)),
                    new TutorialObjective('Renommer la sortie en "Y"', () => this.hasOutputNamed("Y")),
                    new TutorialObjective('Brancher un fil entre la porte non et la sortie', () => this.hasPlacedWireBetween(
                        { gateType: "not" },
                        { componentType: ComponentTypeOutput },
                    )),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Pour vérifier votre circuit, comparez les deux tables de vérité ci-dessous."),
                    new TutorialDoubleTruthTableBlock(
                        () => this.dynamicTruthTableHeaders,
                        () => this.dynamicTruthTableRows,
                        referenceTruthTableHeaders,
                        () => referenceTruthTableRows,
                        () => this.dynamicTruthTableHighlightedRowIndex,
                        () => this.regenerateSimulationTruthTable(),
                    ),
                    new TutorialParagraphBlock("La table de gauche correspond à la simulation de votre circuit : elle est calculée à partir des composants et des fils que vous avez placés. La table de vérité se met à jour dès que vous modifiez votre circuit."),
                    new TutorialParagraphBlock("La table de droite est la table de référence : c’est le résultat qui doit être obtenu pour la fonction Y = A̅."),
                    new TutorialParagraphBlock("Pour tester le circuit, cliquez sur l’entrée A afin de changer sa valeur. La ligne jaune indique le cas actuellement présent sur le circuit."),
                ], [
                    new TutorialObjective("Les deux tables de vérité sont identiques", () => this.hasValidTruthTable()),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Bien joué, vous avez terminé le tutoriel !"),
                    new TutorialParagraphBlock("Vous savez maintenant dessiner un circuit logique :)"),
                ], []),
            ],
            5,
            referenceTruthTableHeaders,
            referenceTruthTableRows,
        )
    }

    private createCompoundLogicTutorial(): TutorialDefinition {
        const referenceTruthTableHeaders: readonly string[] = ["A", "B", "C", "Y"]
        const referenceTruthTableRows: DynamicTruthTableCell[][] = [
            [0, 0, 0, 1],
            [0, 0, 1, 1],
            [0, 1, 0, 1],
            [0, 1, 1, 1],
            [1, 0, 0, 0],
            [1, 0, 1, 0],
            [1, 1, 0, 1],
            [1, 1, 1, 0],
        ]
        const inputA: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "A" }
        const inputB: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "B" }
        const inputC: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "C" }
        const outputY: TutorialComponentMatcher = { componentType: ComponentTypeOutput, name: "Y" }
        const notA: TutorialComponentMatcher = { gateType: "not", inputs: [inputA] }
        const notC: TutorialComponentMatcher = { gateType: "not", inputs: [inputC] }
        const andBNotC: TutorialComponentMatcher = { gateType: "and", inputs: [inputB, notC] }
        const finalOr: TutorialComponentMatcher = { gateType: "or", inputs: [notA, andBNotC] }

        return new TutorialDefinition(
            "one-output-combinational-logic",
            "Dessinez le circuit Y = A̅ ou (B et C̅)",
            "Dessinez un circuit logique classique avec plusieurs entrées et une sortie.",
            () => [
                new TutorialStep([
                    new TutorialParagraphBlock("Vous allez maintenant dessiner le circuit correspondant à la fonction logique Y = A̅ ou (B et C̅)."),
                    new TutorialParagraphBlock("Vous allez construire ce circuit progressivement : d’abord les entrées A, B et C, puis les portes Non, Et et Ou, et enfin la sortie Y."),
                    new TutorialParagraphBlock('Commencez sans aucun circuit, puis cliquez sur "Suivant" pour commencer.'),
                ], [
                    new TutorialObjective("Supprimer tous les composants présents", () => this.hasNoPlacedComponents()),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Commencez par créer trois entrées avec le composant "in".'),
                    new TutorialImageBlock("simulator/img/Input1.svg", "Symbole d’entrée", "Entrée"),
                    new TutorialParagraphBlock('Renommez-les ensuite "A", "B" et "C".'),
                ], [
                    new TutorialObjective('Créer l’entrée "A"', () => this.hasInputNamed("A")),
                    new TutorialObjective('Créer l’entrée "B"', () => this.hasInputNamed("B")),
                    new TutorialObjective('Créer l’entrée "C"', () => this.hasInputNamed("C")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Créez maintenant une porte Non.'),
                    new TutorialImageBlock("simulator/img/not.svg", "Porte logique NON", "Porte non"),
                    new TutorialParagraphBlock("Reliez l’entrée C à cette porte Non pour calculer C̅."),
                ], [
                    new TutorialObjective('Placer une porte non', () => this.hasPlacedGate("not")),
                    new TutorialObjective('Relier l’entrée C à la porte non', () => this.hasPlacedComponentMatching(notC)),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Créez une porte Et (Porte logique "Et" dans la partie "Portes" de la barre à gauche).'),
                    new TutorialImageBlock("simulator/img/and.svg", "Porte logique ET", "Porte et"),
                    new TutorialParagraphBlock("Reliez l’entrée B et la sortie de C̅ à cette porte Et."),
                ], [
                    new TutorialObjective('Placer une porte et', () => this.hasPlacedGate("and")),
                    new TutorialObjective('Relier B et C̅ à la porte et', () => this.hasPlacedComponentMatching(andBNotC)),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Créez une deuxième porte Non.'),
                    new TutorialParagraphBlock("Reliez l’entrée A à cette nouvelle porte Non pour calculer A̅."),
                ], [
                    new TutorialObjective('Placer une deuxième porte non', () => this.hasPlacedGateCount("not", 2)),
                    new TutorialObjective('Relier l’entrée A à la deuxième porte non', () => this.hasPlacedComponentMatching(notA)),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Créez une porte Ou.'),
                    new TutorialImageBlock("simulator/img/or.svg", "Porte logique OU", "Porte ou"),
                    new TutorialParagraphBlock("Reliez A̅ et le résultat de (B et C̅) à cette porte Ou."),
                ], [
                    new TutorialObjective('Placer une porte ou', () => this.hasPlacedGate("or")),
                    new TutorialObjective('Relier A̅ et (B et C̅) à la porte ou', () => this.hasPlacedComponentMatching(finalOr)),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Créez une sortie, et nommez-la "Y".'),
                    new TutorialImageBlock("simulator/img/Output1.svg", "Symbole de sortie", "Sortie"),
                    new TutorialParagraphBlock('Reliez la sortie de la porte Ou à cette sortie Y.'),
                ], [
                    new TutorialObjective('Créer la sortie "Y"', () => this.hasOutputNamed("Y")),
                    new TutorialObjective('Relier la porte ou à la sortie Y', () => this.hasPlacedWireBetween(finalOr, outputY)),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Pour vérifier votre circuit, comparez les deux tables de vérité ci-dessous."),
                    new TutorialDoubleTruthTableBlock(
                        () => this.dynamicTruthTableHeaders,
                        () => this.dynamicTruthTableRows,
                        referenceTruthTableHeaders,
                        () => referenceTruthTableRows,
                        () => this.dynamicTruthTableHighlightedRowIndex,
                        () => this.regenerateSimulationTruthTable(),
                    ),
                    new TutorialParagraphBlock("La table de gauche est calculée par la simulation de votre circuit."),
                    new TutorialParagraphBlock("La table de droite est la référence attendue pour Y = A̅ ou (B et C̅)."),
                    new TutorialParagraphBlock("Si les deux tables sont identiques, votre circuit est correct."),
                ], [
                    new TutorialObjective("Les deux tables de vérité sont identiques", () => this.hasValidTruthTable()),
                ]),
            ],
            7,
            referenceTruthTableHeaders,
            referenceTruthTableRows,
        )
    }
    

    private createAutonomousLogicTutorial(): TutorialDefinition {
        const referenceTruthTableHeaders: readonly string[] = ["A", "B", "C", "Y"]
        const referenceTruthTableRows: DynamicTruthTableCell[][] = [
            [0, 0, 0, 0],
            [0, 0, 1, 1],
            [0, 1, 0, 1],
            [0, 1, 1, 1],
            [1, 0, 0, 0],
            [1, 0, 1, 1],
            [1, 1, 0, 0],
            [1, 1, 1, 1],
        ]
        const inputA: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "A" }
        const inputB: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "B" }
        const inputC: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "C" }
        const outputY: TutorialComponentMatcher = { componentType: ComponentTypeOutput, name: "Y" }
        const andAB: TutorialComponentMatcher = { gateType: "and", inputs: [inputA, inputB] }
        const orAndABC: TutorialComponentMatcher = { gateType: "or", inputs: [andAB, inputC] }
        const notC: TutorialComponentMatcher = { gateType: "not", inputs: [inputC] }
        const andBNotC: TutorialComponentMatcher = { gateType: "and", inputs: [inputB, notC] }
        const finalXor: TutorialComponentMatcher = { gateType: "xor", inputs: [orAndABC, andBNotC] }

        return new TutorialDefinition(
            "autonomous-logic-circuit",
            "Dessinez le circuit Y = ((A et B) ou C) xor (B et C̅)",
            "Dessinez un circuit logique à trois entrées et une sortie.",
            () => [
                new TutorialStep([
                    new TutorialParagraphBlock("Vous allez maintenant dessiner le circuit correspondant à la fonction logique Y = ((A et B) ou C) xor (B et C̅)."),
                    new TutorialParagraphBlock('Commencez par supprimer tous les composants présents. Conservez uniquement trois entrées nommées "A", "B" et "C", ainsi qu’une sortie nommée "Y".'),
                ], [
                    new TutorialObjective('Créer l’entrée "A"', () => this.hasInputNamed("A")),
                    new TutorialObjective('Créer l’entrée "B"', () => this.hasInputNamed("B")),
                    new TutorialObjective('Créer l’entrée "C"', () => this.hasInputNamed("C")),
                    new TutorialObjective('Créer la sortie "Y"', () => this.hasOutputNamed("Y")),
                    new TutorialObjective("Supprimer tout autre composant", () => this.hasOnlyNamedInputsAndOutputs(["A", "B", "C"], ["Y"])),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Dessinez maintenant le circuit correspondant à Y."),
                    new TutorialDoubleTruthTableBlock(
                        () => this.dynamicTruthTableHeaders,
                        () => this.dynamicTruthTableRows,
                        referenceTruthTableHeaders,
                        () => referenceTruthTableRows,
                        () => this.dynamicTruthTableHighlightedRowIndex,
                        () => this.regenerateSimulationTruthTable(),
                    ),
                    new TutorialParagraphBlock("La table de gauche est calculée par la simulation de votre circuit."),
                    new TutorialParagraphBlock("La table de droite est la référence attendue pour Y."),
                    new TutorialParagraphBlock("Si les deux tables sont identiques, votre circuit est correct."),
                ], [
                    new TutorialObjective("Relier le circuit complet à la sortie Y", () => this.hasPlacedWireBetween(finalXor, outputY)),
                    new TutorialObjective("Les deux tables de vérité sont identiques", () => this.hasValidTruthTable()),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Vous avez dessiné votre premier circuit en autonomie !"),
                    new TutorialParagraphBlock("Vous savez maintenant traduire une fonction logique en circuit, puis vérifier votre résultat avec une table de vérité."),
                ], []),
            ],
            1,
            referenceTruthTableHeaders,
            referenceTruthTableRows,
        )
    }

    

    private createTwoOutputAutonomousLogicTutorial(): TutorialDefinition {
        const referenceTruthTableHeaders: readonly string[] = ["A", "B", "C", "Y", "Z"]
        const referenceTruthTableRows: DynamicTruthTableCell[][] = [
            [0, 0, 0, 0, 0],
            [0, 0, 1, 1, 1],
            [0, 1, 0, 0, 1],
            [0, 1, 1, 0, 0],
            [1, 0, 0, 1, 1],
            [1, 0, 1, 0, 1],
            [1, 1, 0, 0, 1],
            [1, 1, 1, 0, 0],
        ]
        const inputA: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "A" }
        const inputB: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "B" }
        const inputC: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "C" }
        const outputY: TutorialComponentMatcher = { componentType: ComponentTypeOutput, name: "Y" }
        const outputZ: TutorialComponentMatcher = { componentType: ComponentTypeOutput, name: "Z" }
        const notB: TutorialComponentMatcher = { gateType: "not", inputs: [inputB] }
        const andANotB: TutorialComponentMatcher = { gateType: "and", inputs: [inputA, notB] }
        const andNotBC: TutorialComponentMatcher = { gateType: "and", inputs: [notB, inputC] }
        const finalY: TutorialComponentMatcher = { gateType: "xor", inputs: [andANotB, andNotBC] }
        const xorBC: TutorialComponentMatcher = { gateType: "xor", inputs: [inputB, inputC] }
        const finalZ: TutorialComponentMatcher = { gateType: "or", inputs: [andANotB, xorBC] }

        return new TutorialDefinition(
            "two-output-autonomous-logic-circuit",
            "Dessinez deux circuits logiques",
            "Dessinez un circuit logique à trois entrées et deux sorties.",
            () => [
                new TutorialStep([
                    new TutorialParagraphBlock("Vous allez maintenant dessiner deux circuits correspondant aux fonctions logiques :"),
                    new TutorialParagraphBlock("Y = (A et B̅) xor (B̅ et C)"),
                    new TutorialParagraphBlock("Z = (A et B̅) ou (B xor C)"),
                    new TutorialParagraphBlock('Commencez par supprimer tous les composants présents. Conservez uniquement trois entrées nommées "A", "B" et "C", ainsi que deux sorties nommées "Y" et "Z".'),
                ], [
                    new TutorialObjective('Créer l’entrée "A"', () => this.hasInputNamed("A")),
                    new TutorialObjective('Créer l’entrée "B"', () => this.hasInputNamed("B")),
                    new TutorialObjective('Créer l’entrée "C"', () => this.hasInputNamed("C")),
                    new TutorialObjective('Créer la sortie "Y"', () => this.hasOutputNamed("Y")),
                    new TutorialObjective('Créer la sortie "Z"', () => this.hasOutputNamed("Z")),
                    new TutorialObjective("Supprimer tout autre composant", () => this.hasOnlyNamedInputsAndOutputs(["A", "B", "C"], ["Y", "Z"])),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Dessinez maintenant les circuits correspondant à Y et Z."),
                    new TutorialParagraphBlock("Y = (A et B̅) xor (B̅ et C)"),
                    new TutorialParagraphBlock("Z = (A et B̅) ou (B xor C)"),
                    new TutorialDoubleTruthTableBlock(
                        () => this.dynamicTruthTableHeaders,
                        () => this.dynamicTruthTableRows,
                        referenceTruthTableHeaders,
                        () => referenceTruthTableRows,
                        () => this.dynamicTruthTableHighlightedRowIndex,
                        () => this.regenerateSimulationTruthTable(),
                    ),
                    new TutorialParagraphBlock("Attention, vous devez utiliser exactement 6 portes pour dessiner les deux circuits."),
                    new TutorialParagraphBlock("Sachez que vous pouvez tirer plusieurs fils depuis une même entrée (et depuis la même sortie d'une porte).")
                ], [
                    new TutorialObjective("Utiliser exactement 6 portes", () => this.hasPlacedGateTotalCount(6)),
                    new TutorialObjective("Relier le circuit complet à la sortie Y", () => this.hasPlacedWireBetween(finalY, outputY)),
                    new TutorialObjective("Relier le circuit complet à la sortie Z", () => this.hasPlacedWireBetween(finalZ, outputZ)),
                    new TutorialObjective("Les deux tables de vérité sont identiques", () => this.hasValidTruthTable()),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Vous avez dessiné votre premier circuit à deux sorties !"),
                    new TutorialParagraphBlock("Vous savez maintenant partager des morceaux de circuit entre plusieurs sorties."),
                ], []),
            ],
            1,
            referenceTruthTableHeaders,
            referenceTruthTableRows,
        )
    }


    private createPixelTutorial(): TutorialDefinition {
        const pixelComponentType = "pixel"
        const colorTruthTableHeaders: readonly string[] = ["X", "R", "G", "B"]
        const colorTruthTableRows: DynamicTruthTableCell[][] = [
            [0, 0, 0, 1],
            [1, 1, 0, 0],
        ]
        const inputX: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "X" }
        const notX: TutorialComponentMatcher = { gateType: "not", inputs: [inputX] }
        const xorGate: TutorialComponentMatcher = { gateType: "xor" }

        const hasInputConnectedToPixel = (inputName: string, pixelInputName: string) =>
            this.hasPlacedWireFromInputToComponentInput(inputName, pixelComponentType, pixelInputName)
        const hasComponentConnectedToPixel = (from: TutorialComponentMatcher, pixelInputName: string) =>
            this.hasPlacedWireFromComponentToComponentInput(from, pixelComponentType, pixelInputName)

        return new TutorialDefinition(
            "pixel",
            "Manipuler un pixel",
            "Créez un pixel et contrôlez sa couleur avec trois bits.",
            () => [
                new TutorialStep([
                    new TutorialParagraphBlock("Vous allez manipuler un pixel à partir de trois entrées logiques, chacune représentant une composante de couleur."),
                    new TutorialParagraphBlock("Un pixel coloré est composé de trois composantes : rouge, vert et bleu. On les note souvent R (red), G (green) et B (blue)."),
                    new TutorialParagraphBlock("Chaque composante est représentée avec un bit : 1 pour allumer la couleur, 0 pour l’éteindre."),
                    new TutorialParagraphBlock('Supprimez tous les composants présents avant de commencer.'),
                ], [
                    new TutorialObjective("Supprimer tous les composants présents", () => this.hasNoPlacedComponents()),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Dans la section "Entrées/sorties" de la barre de gauche, cliquez sur "Plus" pour afficher les composants supplémentaires.'),
                    new TutorialImageBlock("simulator/img/Pixel.svg", "Symbole du pixel", "Pixel"),
                    new TutorialParagraphBlock('Cliquez ensuite sur le composant "Pixel" pour l’ajouter.'),
                ], [
                    new TutorialObjective("Créer le composant Pixel", () => this.hasPlacedComponent(pixelComponentType)),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Créez trois entrées, et nommez-les "R", "G" et "B".'),
                    new TutorialParagraphBlock("Reliez R à l’entrée en haut du pixel, G à l’entrée à gauche, et B à l’entrée en bas."),
                ], [
                    new TutorialObjective('Créer l’entrée "R"', () => this.hasInputNamed("R")),
                    new TutorialObjective('Créer l’entrée "G"', () => this.hasInputNamed("G")),
                    new TutorialObjective('Créer l’entrée "B"', () => this.hasInputNamed("B")),
                    new TutorialObjective("Relier R à l’entrée en haut du pixel", () => hasInputConnectedToPixel("R", "R")),
                    new TutorialObjective("Relier G à l’entrée à gauche du pixel", () => hasInputConnectedToPixel("G", "G")),
                    new TutorialObjective("Relier B à l’entrée en bas du pixel", () => hasInputConnectedToPixel("B", "B")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Manipulez maintenant les valeurs des entrées en cliquant dessus, pour changer la couleur du pixel."),
                    new TutorialParagraphBlock("Faites en sorte que le pixel soit jaune."),
                ], [
                    new TutorialObjective("Le pixel est jaune", () =>
                        hasInputConnectedToPixel("R", "R")
                        && hasInputConnectedToPixel("G", "G")
                        && hasInputConnectedToPixel("B", "B")
                        && this.hasInputValue("R", true)
                        && this.hasInputValue("G", true)
                        && this.hasInputValue("B", false)
                    ),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Vous allez maintenant créer un circuit logique qui prend en entrée un bit."),
                    new TutorialParagraphBlock("Si ce bit vaut 0, alors le pixel doit être bleu. Si ce bit vaut 1, alors le pixel doit être rouge."),
                    new TutorialParagraphBlock('Pour repartir proprement, supprimez les trois entrées "R", "G" et "B", mais gardez le pixel.'),
                ], [
                    new TutorialObjective('Supprimer les entrées "R", "G" et "B"', () => !this.hasInputNamed("R") && !this.hasInputNamed("G") && !this.hasInputNamed("B")),
                    new TutorialObjective("Garder le composant Pixel", () => this.hasPlacedComponent(pixelComponentType)),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Voici ce que doit faire le circuit : si X = 0, le pixel est bleu; si X = 1, le pixel est rouge."),
                    new TutorialTruthTableBlock(colorTruthTableHeaders, () => colorTruthTableRows),
                    new TutorialParagraphBlock("La table utilise une entrée X et trois sorties R, G et B, qui correspondent aux trois composantes du pixel."),
                    new TutorialParagraphBlock("Rappel : on peut tirer plusieurs fils depuis une même entrée (l’entrée X pourra donc servir à plusieurs endroits du circuit)."),
                    new TutorialParagraphBlock('Créez maintenant une entrée et nommez-la "X".'),
                ], [
                    new TutorialObjective('Créer l’entrée "X"', () => this.hasInputNamed("X")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Commençons par la composante rouge."),
                    new TutorialTruthTableBlock(colorTruthTableHeaders, () => colorTruthTableRows),
                    new TutorialParagraphBlock("La colonne R est exactement la même que la colonne X."),
                    new TutorialParagraphBlock("Il suffit donc de relier directement X à la composante rouge du pixel, c'est-à-dire l'entrée en haut du pixel."),
                ], [
                    new TutorialObjective("Relier X à la composante rouge du pixel", () => hasInputConnectedToPixel("X", "R")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Passons à la composante bleue."),
                    new TutorialTruthTableBlock(colorTruthTableHeaders, () => colorTruthTableRows),
                    new TutorialParagraphBlock("La composante bleue correspond à la fonction logique B = X̅."),
                    new TutorialParagraphBlock("Ajoutez une porte Non, reliez l'entrée X à cette porte (vous pouvez créer plusieurs fils depuis une même entrée), puis reliez la sortie de la porte Non à la composante bleue du pixel, c'est-à-dire l'entrée en bas du pixel."),
                ], [
                    new TutorialObjective("Placer une porte non", () => this.hasPlacedGate("not")),
                    new TutorialObjective("Relier l'entrée X à la porte non", () => this.hasPlacedComponentMatching(notX)),
                    new TutorialObjective("Relier la porte Non à la composante bleue du pixel", () => hasComponentConnectedToPixel(notX, "B")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Finissons par la composante verte."),
                    new TutorialTruthTableBlock(colorTruthTableHeaders, () => colorTruthTableRows),
                    new TutorialParagraphBlock("Quelle que soit la valeur de X, la variable G vaut toujours 0."),
                    new TutorialParagraphBlock("Pour obtenir ce 0, vous pouvez utiliser une porte Xor."),
                    new TutorialImageBlock("simulator/img/xor.svg", "Porte logique XOR", "Porte xor"),
                    new TutorialParagraphBlock("Si les deux entrées d’une porte Xor ont la même valeur, son résultat vaut 0."),
                    new TutorialParagraphBlock("Reliez donc l’entrée X aux deux entrées de la porte Xor : vous obtiendrez 0, que X vaille 0 ou 1. Reliez ensuite la sortie de cette porte à l’entrée gauche du pixel."),
                    new TutorialParagraphBlock("Pour améliorer la lisibilité de votre circuit, vous pouvez déplacer les fils : cliquez sur le fil, et maintenez le clic en déplaçant le fil."),
                ], [
                    new TutorialObjective("Poser une porte Xor", () => this.hasPlacedGate("xor")),
                    new TutorialObjective("Relier X aux deux entrées de la porte Xor", () => this.hasGateWithIncomingWireCountFromInput("xor", "A", 2)),
                    new TutorialObjective("Relier la porte Xor à la composante verte du pixel", () => hasComponentConnectedToPixel(xorGate, "G")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Bien joué, vous avez créé votre premier circuit logique avec plusieurs sorties !"),
                ], []),
            ],
        )
    }

    private createTwoBitPixelTutorial(): TutorialDefinition {
        const pixelComponentType = "pixel"
        const referenceTruthTableHeaders: readonly string[] = ["X", "Z", "R", "G", "B"]
        const referenceTruthTableRows: DynamicTruthTableCell[][] = [
            [0, 0, 0, 0, 1],
            [0, 1, 0, 0, 0],
            [1, 0, 0, 1, 0],
            [1, 1, 1, 0, 1],
        ]

        const hasOnlyStartingComponents = () =>
            this.placedComponents().length === 2
            && this.hasInputNamed("X")
            && this.hasInputNamed("Z")

        return new TutorialDefinition(
            "two-bit-pixel-color",
            "Contrôler un pixel avec 2 bits",
            "Concevez un circuit qui transforme deux bits en couleur.",
            () => [
                new TutorialStep([
                    new TutorialParagraphBlock("Vous allez maintenant contrôler la couleur d’un pixel avec deux bits d’entrée."),
                    new TutorialParagraphBlock('Créez deux entrées "X" et "Z". Supprimez tous les autres composants avant de continuer.'),
                ], [
                    new TutorialObjective('Créer l’entrée "X"', () => this.hasInputNamed("X")),
                    new TutorialObjective('Créer l’entrée "Z"', () => this.hasInputNamed("Z")),
                    new TutorialObjective("Supprimer tout autre composant", hasOnlyStartingComponents),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("On veut associer une couleur à chaque combinaison des deux bits X et Z :"),
                    new TutorialParagraphBlock(" - X = 0, Z = 0 → Bleu"),
                    new TutorialParagraphBlock(" - X = 0, Z = 1 → Noir"),
                    new TutorialParagraphBlock(" - X = 1, Z = 0 → Vert"),
                    new TutorialParagraphBlock(" - X = 1, Z = 1 → Magenta"),
                    new TutorialParagraphBlock('Avant de commencer la construction du circuit, ajoutez trois sorties nommées "R", "G" et "B". Vous utiliserez ces sorties pour créer le cricuit, et vous pourrez les remplacer par le composant pixel après:'),
                ], [
                    new TutorialObjective('Créer la sortie "R"', () => this.hasOutputNamed("R")),
                    new TutorialObjective('Créer la sortie "G"', () => this.hasOutputNamed("G")),
                    new TutorialObjective('Créer la sortie "B"', () => this.hasOutputNamed("B")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Voici ce que ça donne en table de vérité : les colonnes R, G et B indiquent quelles composantes du pixel doivent être allumées."),
                    new TutorialDoubleTruthTableBlock(
                        () => this.dynamicTruthTableHeaders,
                        () => this.dynamicTruthTableRows,
                        referenceTruthTableHeaders,
                        () => referenceTruthTableRows,
                        () => this.dynamicTruthTableHighlightedRowIndex,
                        () => this.regenerateSimulationTruthTable(),
                    ),
                    new TutorialParagraphBlock("La sortie R correspond à la fonction R = X et Z. Retrouvez les deux autres fonctions, puis construisez le circuit correspondant."),
                    new TutorialParagraphBlock("Aidez-vous de la table de vérité correspondant à la simulation : elle se met à jour dès que vous modifiez votre circuit."),
                ], [
                    new TutorialObjective("Les deux tables de vérité sont identiques", () => this.hasValidTruthTable()),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock('Ajoutez un composant Pixel, puis reliez les fils correspondants aux sorties R, G et B du circuit aux entrées R, G et B du pixel.'),
                ], [
                    new TutorialObjective("Placer un composant Pixel", () => this.hasPlacedComponent(pixelComponentType)),
                    new TutorialObjective("Relier l'entrée rouge du pixel", () => this.hasPlacedWireToComponentInput(pixelComponentType, "R")),
                    new TutorialObjective("Relier l'entrée verte du pixel", () => this.hasPlacedWireToComponentInput(pixelComponentType, "G")),
                    new TutorialObjective("Relier l'entrée bleue du pixel", () => this.hasPlacedWireToComponentInput(pixelComponentType, "B")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Bien joué, vous venez d’apprendre à concevoir un circuit logique pour implémenter une fonctionnalité."),
                    new TutorialParagraphBlock("Ici, vous avez obtenu une couleur à partir d’un nombre encodé sur deux bits."),
                ], []),
           
            ],
            2,
            referenceTruthTableHeaders,
            referenceTruthTableRows,
        )
    }

    

    private createTruthTableWarmupTutorial(): TutorialDefinition {
        const warmupTruthTableHeaders: readonly string[] = ["A", "B", "Y"]
        const warmupAndNotBTruthTableRows: DynamicTruthTableCell[][] = [
            [0, 0, 0],
            [0, 1, 0],
            [1, 0, 1],
            [1, 1, 0],
        ]
        const warmupOrNotBTruthTableRows: DynamicTruthTableCell[][] = [
            [0, 0, 1],
            [0, 1, 0],
            [1, 0, 1],
            [1, 1, 1],
        ]
        const inputA: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "A" }
        const inputB: TutorialComponentMatcher = { componentType: ComponentTypeInput, name: "B" }
        const outputY: TutorialComponentMatcher = { componentType: ComponentTypeOutput, name: "Y" }
        const warmupAndAB: TutorialComponentMatcher = { gateType: "and", inputs: [inputA, inputB] }
        const warmupNotB: TutorialComponentMatcher = { gateType: "not", inputs: [inputB] }
        const warmupAndANotB: TutorialComponentMatcher = { gateType: "and", inputs: [inputA, warmupNotB] }
        const warmupOrANotB: TutorialComponentMatcher = { gateType: "or", inputs: [inputA, warmupNotB] }

        return new TutorialDefinition(
            "truth-table-to-logic-warmup",
            "Échauffement du défi",
            "Retrouvez une fonction logique à partir d’une table de vérité.",
            () => [
                new TutorialStep([
                    new TutorialParagraphBlock("Vous allez voir comment retrouver une fonction logique à partir de la table de vérité."),
                    new TutorialParagraphBlock('Commencez par créer deux variables d’entrée nommées "A" et "B", et une variable de sortie nommée "Y". Supprimez tout autre composant avant de continuer.'),
                ], [
                    new TutorialObjective('Créer l’entrée "A"', () => this.hasInputNamed("A")),
                    new TutorialObjective('Créer l’entrée "B"', () => this.hasInputNamed("B")),
                    new TutorialObjective('Créer la sortie "Y"', () => this.hasOutputNamed("Y")),
                    new TutorialObjective("Supprimer tout autre composant", () => this.hasOnlyNamedInputsAndOutputs(["A", "B"], ["Y"])),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Voici une table de vérité."),
                    new TutorialDoubleTruthTableBlock(
                        () => this.dynamicTruthTableHeaders,
                        () => this.dynamicTruthTableRows,
                        warmupTruthTableHeaders,
                        () => warmupAndNotBTruthTableRows,
                        () => this.dynamicTruthTableHighlightedRowIndex,
                        () => this.regenerateSimulationTruthTable(),
                    ),
                    new TutorialParagraphBlock("Ici, Y vaut 1 dans un seul cas : A = 1, B = 0."),
                    new TutorialParagraphBlock("Vous connaissez une seule fonction logique où la sortie vaut 1 dans un seul cas : la fonction Et."),
                    new TutorialParagraphBlock("Posez une porte Et, puis reliez A et B à cette porte, et la porte Et à la sortie Y."),
                ], [
                    new TutorialObjective("Relier A et B à une porte Et", () => this.hasPlacedComponentMatching(warmupAndAB)),
                    new TutorialObjective("Relier la porte Et à la sortie Y", () => this.hasPlacedWireBetween(warmupAndAB, outputY)),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Cependant, les deux tables de vérité ne sont pas les mêmes."),
                    new TutorialDoubleTruthTableBlock(
                        () => this.dynamicTruthTableHeaders,
                        () => this.dynamicTruthTableRows,
                        warmupTruthTableHeaders,
                        () => warmupAndNotBTruthTableRows,
                        () => this.dynamicTruthTableHighlightedRowIndex,
                        () => this.regenerateSimulationTruthTable(),
                    ),
                    new TutorialParagraphBlock("Actuellement, la sortie de votre circuit est égale à 1 quand A vaut 1 et B vaut 1."),
                    new TutorialParagraphBlock("Pour changer cela, posez une porte Non après l’entrée B. La sortie de votre circuit ne sera égale à 1 que quand A vaut 1 et B vaut 0."),
                ], [
                    new TutorialObjective("Relier B à une porte Non", () => this.hasPlacedComponentMatching(warmupNotB)),
                    new TutorialObjective("Relier A et B̅ à la porte Et", () => this.hasPlacedComponentMatching(warmupAndANotB)),
                    new TutorialObjective("Relier le circuit à la sortie Y", () => this.hasPlacedWireBetween(warmupAndANotB, outputY)),
                    new TutorialObjective("Les deux tables de vérité sont identiques", () => this.hasDynamicTruthTableMatching(warmupTruthTableHeaders, warmupAndNotBTruthTableRows)),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Maintenant, voyons si vous avez compris : dessinez le circuit correspondant à la table de vérité suivante."),
                    new TutorialDoubleTruthTableBlock(
                        () => this.dynamicTruthTableHeaders,
                        () => this.dynamicTruthTableRows,
                        warmupTruthTableHeaders,
                        () => warmupOrNotBTruthTableRows,
                        () => this.dynamicTruthTableHighlightedRowIndex,
                        () => this.regenerateSimulationTruthTable(),
                    ),
                    new TutorialHintBlock("Vous avez besoin d’une porte Ou et d’une porte Non."),
                ], [
                    new TutorialObjective("Les deux tables de vérité sont identiques", () => this.hasDynamicTruthTableMatching(warmupTruthTableHeaders, warmupOrNotBTruthTableRows)),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Bravo, vous savez maintenant retrouver une fonction logique à partir d’une table de vérité : s’il y a un seul 1, utilisez une porte Et; s’il y a deux 1, utilisez une porte Xor; et s’il y a trois 1, utilisez une porte Ou."),
                    new TutorialParagraphBlock("Vous êtes maintenant paré à affronter le défi !"),
                ], []),
            ],
            1,
            warmupTruthTableHeaders,
            warmupAndNotBTruthTableRows,
        )
    }


    private createThreeBitPixelChallengeTutorial(): TutorialDefinition {
        const pixelComponentType = "pixel"
        const referenceTruthTableHeaders: readonly string[] = ["W", "X", "Z", "R", "G", "B"]
        const referenceTruthTableRows: DynamicTruthTableCell[][] = [
            [0, 0, 0, 1, 0, 1],
            [0, 0, 1, 1, 0, 0],
            [0, 1, 0, 0, 0, 0],
            [0, 1, 1, 0, 1, 1],
            [1, 0, 0, 0, 0, 1],
            [1, 0, 1, 0, 1, 0],
            [1, 1, 0, 1, 1, 1],
            [1, 1, 1, 1, 1, 0],
        ]

        const hasNoExtraChallengeComponents = () => {
            const components = this.placedComponents()
            const inputs = components.filter(comp => this.isInputComponent(comp))
            const outputs = components.filter(comp => this.isOutputComponent(comp))
            const allowedInputs = ["W", "X", "Z"]
            const allowedOutputs = ["R", "G", "B"]
            const hasNoDuplicateNames = (names: Array<string | undefined>) => new Set(names).size === names.length
            const componentName = (component: Input | Output) =>
                typeof component.name === "string" ? component.name : undefined

            return inputs.length + outputs.length === components.length
                && inputs.every(input => allowedInputs.includes(componentName(input) ?? ""))
                && outputs.every(output => allowedOutputs.includes(componentName(output) ?? ""))
                && hasNoDuplicateNames(inputs.map(componentName))
                && hasNoDuplicateNames(outputs.map(componentName))
        }

        return new TutorialDefinition(
            "three-bit-pixel-color-challenge",
            "Défi : Conception d'un circuit logique",
            "Concevez par vous même un circuit qui transforme un nombre binaire en couleur.",
            () => [
                new TutorialStep([
                    new TutorialParagraphBlock("Bienvenue dans le dernier tutoriel : il est plus difficile que les précédents, maintenant que vous savez bien dessiner des circuits logiques."),
                    new TutorialParagraphBlock("Vous allez concevoir votre propre système qui, à partir d'un nombre (encodé en binaire), colorie un pixel dans une certaine couleur."),
                    new TutorialParagraphBlock('Cliquez sur "Suivant" pour commencer le défi.'),
                ], []),
                new TutorialStep([
                    new TutorialParagraphBlock("Voici la correspondance que vous devez implémenter :"),
                    new TutorialParagraphBlock(" - 0 (000) -> Magenta"),
                    new TutorialParagraphBlock(" - 1 (001) -> Rouge"),
                    new TutorialParagraphBlock(" - 2 (010) -> Noir"),
                    new TutorialParagraphBlock(" - 3 (011) -> Cyan"),
                    new TutorialParagraphBlock(" - 4 (100) -> Bleu"),
                    new TutorialParagraphBlock(" - 5 (101) -> Vert"),
                    new TutorialParagraphBlock(" - 6 (111) -> Blanc"),
                    new TutorialParagraphBlock(" - 7 (110) -> Jaune"),
                    new TutorialParagraphBlock("La table de vérité est donc composée de trois entrées (W, X et Z) et de trois sorties (R, G et B)."),
                    new TutorialTruthTableBlock(referenceTruthTableHeaders, () => referenceTruthTableRows),
                    new TutorialParagraphBlock('Créez maintenant trois entrées nommées "W", "X" et "Z", puis trois sorties nommées "R", "G" et "B". Supprimez tout autre composant avant de continuer.'),
                ], [
                    new TutorialObjective('Créer l’entrée "W"', () => this.hasInputNamed("W")),
                    new TutorialObjective('Créer l’entrée "X"', () => this.hasInputNamed("X")),
                    new TutorialObjective('Créer l’entrée "Z"', () => this.hasInputNamed("Z")),
                    new TutorialObjective('Créer la sortie "R"', () => this.hasOutputNamed("R")),
                    new TutorialObjective('Créer la sortie "G"', () => this.hasOutputNamed("G")),
                    new TutorialObjective('Créer la sortie "B"', () => this.hasOutputNamed("B")),
                    new TutorialObjective("Supprimer tout autre composant", hasNoExtraChallengeComponents),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Retrouvez les fonctions logiques correspondant à R, G et B, puis construisez le circuit."),
                    new TutorialDoubleTruthTableBlock(
                        () => this.dynamicTruthTableHeaders,
                        () => this.dynamicTruthTableRows,
                        referenceTruthTableHeaders,
                        () => referenceTruthTableRows,
                        () => this.dynamicTruthTableHighlightedRowIndex,
                        () => this.regenerateSimulationTruthTable(),
                    ),
                    new TutorialParagraphBlock("Aidez-vous de la table simulée : elle se met à jour dès que vous modifiez votre circuit."),
                    new TutorialHintBlock("Quand un problème semble complexe, séparez-le en sous-problèmes plus simples. Séparez la table de vérité en deux : une table de vérité quand W = 0 (qui vous donne fonction logique K), et une table de vérité quand W = 1 (qui vous donne fonction logique L). Puis ensuite, combinez les deux fonctions logiques : (W = 0 et K) ou (W = 1 et L) ⟶ (W̅ et K) ou (W et L)"),
                ], [
                    new TutorialObjective("Les deux tables de vérité sont identiques", () => this.hasValidTruthTable()),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Ajoutez un composant Pixel, puis reliez les sorties R, G et B du circuit aux entrées R, G et B du pixel."),
                    new TutorialParagraphBlock("Vérifiez ensuite que le pixel prend la bonne couleur pour chaque combinaison des entrées W, X et Z."),
                ], [
                    new TutorialObjective("Placer un composant Pixel", () => this.hasPlacedComponent(pixelComponentType)),
                    new TutorialObjective("Relier l'entrée rouge du pixel", () => this.hasPlacedWireToComponentInput(pixelComponentType, "R")),
                    new TutorialObjective("Relier l'entrée verte du pixel", () => this.hasPlacedWireToComponentInput(pixelComponentType, "G")),
                    new TutorialObjective("Relier l'entrée bleue du pixel", () => this.hasPlacedWireToComponentInput(pixelComponentType, "B")),
                ]),
                new TutorialStep([
                    new TutorialParagraphBlock("Bien joué, vous avez terminé le défi, plus rien ne peut vous arrêter maintenant !"),
                ], []),
            ],
            2,
            referenceTruthTableHeaders,
            referenceTruthTableRows,
        )
    }
}