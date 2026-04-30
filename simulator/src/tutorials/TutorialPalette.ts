// simulator/src/TutorialPalette.ts
import { Component, ComponentState } from "../components/Component"
import { ComponentListChangeReason } from "../ComponentList"
import { GateBase } from "../components/Gate"
import { Input } from "../components/Input"
import { Output } from "../components/Output"
import { LogicEditor } from "../LogicEditor"
import { button, cls, div, input, label, span, type } from "../htmlgen"
import { ComponentTypeInput, ComponentTypeOutput, LogicValue, setVisible } from "../utils"
import { TutorialContent, TutorialContentBlock, TutorialDoubleTruthTableBlock, TutorialImageBlock, TutorialParagraphBlock } from "./TutorialContent"

type TutorialComponentMatcher =
    | { componentType: string }
    | { gateType: string }

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

export class TutorialPalette {
    public readonly rootElem: HTMLDivElement
    private readonly content: TutorialContent
    private readonly nextButton: HTMLButtonElement
    private readonly previousButton: HTMLButtonElement
    private readonly pageCounter: HTMLSpanElement
    private readonly checklistElem: HTMLDivElement
    private currentObjectiveCheckboxes: HTMLInputElement[] = []
    private completionListenerCleanups: Array<() => void> = []
    private readonly manuallyCompletedObjectives = new Set<string>()
    private truthTableTestState: TruthTableTestState = "unknown"
    private truthTableTestIsRunning = false
    private truthTableTestRunId = 0
    private dynamicTruthTableHeaders: readonly string[] = ["A", "Y = A̅"]
    private readonly referenceTruthTableHeaders: readonly string[] = ["A", "Y = A̅"]
    private dynamicTruthTableHasInputsAndOutputs = false
    private readonly referenceTruthTableRows: DynamicTruthTableCell[][] = [
        [0, 1],
        [1, 0],
    ]
    private dynamicTruthTableRows: DynamicTruthTableCell[][] = [
        [0, "?"],
        [1, "?"],
    ]
    private dynamicTruthTableHighlightedRowIndex: number | undefined = undefined
    private currentStep = 0

    /** Tutorial steps */
    private readonly step0: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock('Bienvenue dans le simulateur logique "Logic" !'),
        new TutorialParagraphBlock("Il vous permet de dessiner des circuits logiques en plaçant des entrées, des portes logiques, des sorties, puis en les reliant avec des fils."),
        new TutorialParagraphBlock("Dans ce tutoriel, vous allez construire le circuit correspondant à la fonction logique Y = A̅."),
        new TutorialParagraphBlock('Cliquez sur "Suivant" pour commencer.'),
   
    ], [])
    private readonly step1: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock('Les composants se trouvent dans la barre située à gauche du simulateur. L’entrée logique correspond au composant "in".'),
        new TutorialImageBlock("simulator/img/Input1.svg", "Symbole d’entrée", "Entrée"),
        new TutorialParagraphBlock('Cliquez sur l\'icône pour en faire apparaître une sur le canevas.'),
        new TutorialParagraphBlock("Vous pouvez ensuite déplacer cette entrée (cliquez dessus et maintenez le clic enfoncé durant le déplacement')."),
        new TutorialParagraphBlock('Pour renommer l’entrée, cliquez dessus avec deux doigts, sélectionnez le menu "Set Name...". Nommez cette entrée "A".'),
    ], [
        new TutorialObjective('Placer un objet "in" sur le canevas', () => this.hasPlacedComponent(ComponentTypeInput)),
        new TutorialObjective('Renommer l’entrée en "A"', () => this.hasInputNamed("A")),
    ])
    private readonly step2: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock('Ajoutez maintenant la porte logique Non. Elle s’appelle "Not" et se trouve dans la partie "Gates" de la barre de gauche.'),
        new TutorialImageBlock("simulator/img/not.svg", "Porte logique NON", "Porte non"),
        new TutorialParagraphBlock('Cliquez sur la porte "Not" pour la faire apparaître, puis déplacez-la à droite de l’entrée A.'),
        new TutorialParagraphBlock("Pour relier l’entrée à la porte, cliquez sur le point situé à droite de l’entrée, maintenez le clic, puis amenez le fil qui apparaît jusqu’au point situé à gauche de la porte Non."),
    ], [
        new TutorialObjective('Placer une porte "not" sur le canevas', () => this.hasPlacedGate("not")),
        new TutorialObjective('Relier l’entrée A à la porte "not"', () => this.hasPlacedWireBetween(
            { componentType: ComponentTypeInput },
            { gateType: "not" },
        )),
    ])
    private readonly step3: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock("Il arrive régulièrement de faire des erreurs !"),
        new TutorialParagraphBlock("Pour supprimer un élément, sélectionnez-le sur le canevas, puis appuyez sur la touche Backspace, celle qui se trouve au-dessus de la touche Entrée sur le clavier."),
        new TutorialParagraphBlock("Pour cette étape, supprimez la porte Non que vous venez d’ajouter."),
    ], [
        new TutorialObjective('Supprimer la porte non', () => !this.hasPlacedGate("not")),
    ])
    private readonly step4: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock("Reconstruisez maintenant le circuit complet."),
        new TutorialParagraphBlock('Ajoutez une porte Non depuis la partie "Gates" de la barre de gauche, puis déplacez-la à droite de l’entrée A.'),
        new TutorialParagraphBlock('Ajoutez ensuite une sortie : le composant se nomme "out" et se trouve lui aussi dans la barre de gauche. Placez cette sortie à droite de la porte Non.'),
        new TutorialImageBlock("simulator/img/Output1.svg", "Symbole de sortie", "Sortie"),
        new TutorialParagraphBlock('Renommez la sortie en cliquant dessus avec deux doigts, puis en sélectionnant "Set Name...". Nommez cette sortie "Y".'),
        new TutorialParagraphBlock("Enfin, reliez l’entrée A à la porte Non, puis reliez la porte Non à la sortie Y (cliquez sur le point situé à droite de la porte Non et maintenez le clic pendant le déplacement pour créer le fil et l'amener jusqu’au point situé à gauche de la sortie Y)."),
        
    ], [
        new TutorialObjective('Remettre une porte "not" sur le canevas', () => this.hasPlacedGate("not")),
        new TutorialObjective('Placer un objet "out" sur le canevas', () => this.hasPlacedComponent(ComponentTypeOutput)),
        new TutorialObjective('Renommer la sortie en "Y"', () => this.hasOutputNamed("Y")),
        new TutorialObjective('Relier l’entrée A à la porte "not"', () => this.hasPlacedWireBetween(
            { componentType: ComponentTypeInput },
            { gateType: "not" },
        )),
        new TutorialObjective('Brancher un fil entre "not" et "out"', () => this.hasPlacedWireBetween(
            { gateType: "not" },
            { componentType: ComponentTypeOutput },
        )),
    ])
    private readonly step5: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock("Pour vérifier votre circuit, comparez les deux tables de vérité ci-dessous."),
        new TutorialDoubleTruthTableBlock(
            () => this.dynamicTruthTableHeaders,
            () => this.dynamicTruthTableRows,
            this.referenceTruthTableHeaders,
            () => this.referenceTruthTableRows,
            () => this.dynamicTruthTableHighlightedRowIndex,
        ),
        new TutorialParagraphBlock("La table de gauche correspond à la simulation de votre circuit : elle est calculée automatiquement à partir des composants et des fils que vous avez placés."),
        new TutorialParagraphBlock("La table de droite est la table de référence : c’est le résultat qui doit être obtenu pour la fonction Y = A̅."),
        new TutorialParagraphBlock("Pour tester le circuit, cliquez sur l’entrée A afin de changer sa valeur. La ligne jaune indique le cas actuellement présent sur le circuit."),
    ], 
    [
        new TutorialObjective("Comparer le circuit avec la table de vérité", () => this.hasValidTruthTable()),
    ])
    private readonly step6: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock("Bien joué, vous avez réussi le TP !"),
        new TutorialParagraphBlock("Vous savez maintenant dessiner un circuit logique :)"),
    ], [])

    private readonly steps = [
        this.step0,
        this.step1,
        this.step2,
        this.step3,
        this.step4,
        this.step5,
        this.step6,
    ]

    public constructor(private readonly editor: LogicEditor) {
        const close = span("×", cls("tutorial-close")).render()
        close.addEventListener("click", () => editor.setTutorialPaletteVisible(false))
        close.addEventListener("pointerdown", e => e.stopPropagation())

        this.content = new TutorialContent(editor)

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

        const heading = div(cls("tutorial-heading"),
            div(cls("tutorial-title"),
                "Tutoriel : Dessinez le circuit Y = A̅",
            ),
            close,
        ).render()
        heading.addEventListener("pointerdown", e => this.startDraggingPalette(e))

        this.rootElem = div(cls("tutorial-palette sim-toolbar-right"),
            heading,
            this.content.rootElem,
            this.checklistElem,
            div(cls("tutorial-actions"),
                this.previousButton,
                this.pageCounter,
                this.nextButton,
            ),
        ).render()

        this.updateDisplayedStep()
        setVisible(this.rootElem, false)
        editor.html.canvasContainer.appendChild(this.rootElem)
    }

    public setVisible(visible: boolean) {
        setVisible(this.rootElem, visible)
        if (visible) {
            this.startListeningForCompletionChanges()
            this.refreshCompletionState()
        } else {
            this.stopListeningForCompletionChanges()
        }
    }

    private goToNextStep() {
        if (this.currentStep === this.steps.length - 1) {
            this.editor.setTutorialPaletteVisible(false)
        } else if (this.isCurrentStepCompleted()) {
            this.currentStep++
            this.updateDisplayedStep()
        }
    }

    private goToPreviousStep() {
        if (this.currentStep > 0) {
            this.currentStep--
            this.updateDisplayedStep()
        }
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

    private updateDisplayedStep() {
        this.content.setBlocks(this.steps[this.currentStep].content)
        this.pageCounter.textContent = `Etape ${this.currentStep + 1} / ${this.steps.length}`
        this.nextButton.textContent = this.currentStep === this.steps.length - 1 ? "Fermer" : "Suivant"
        this.renderChecklist()
        this.refreshCompletionState()
        setVisible(this.nextButton, true)
        setVisible(this.previousButton, this.currentStep > 0)
    }

    private refreshCompletionState() {
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

    private isObjectiveManuallyCompleted(stepIndex: number, objectiveIndex: number): boolean {
        return this.manuallyCompletedObjectives.has(this.objectiveKey(stepIndex, objectiveIndex))
    }

    private objectiveKey(stepIndex: number, objectiveIndex: number): string {
        return `${stepIndex}:${objectiveIndex}`
    }

    private hasValidTruthTable(): boolean {
        return this.truthTableTestState === "passed"
    }

    private resetTruthTableTest() {
        this.truthTableTestState = "unknown"
        this.truthTableTestRunId++
    }

    private scheduleTruthTableTestIfNeeded() {
        if (
            this.currentStep !== this.steps.indexOf(this.step5)
            || this.truthTableTestState !== "unknown"
            || this.truthTableTestIsRunning
        ) {
            return
        }
        this.runTruthTableTest()
    }

    private async runTruthTableTest() {
        const runId = ++this.truthTableTestRunId
        this.truthTableTestState = "running"
        this.truthTableTestIsRunning = true

        try {
            await this.rebuildDynamicTruthTable(runId)
            if (runId !== this.truthTableTestRunId) {
                return
            }

            this.truthTableTestState = this.areTruthTablesEqual() ? "passed" : "failed"
            this.refreshCompletionState()
        } finally {
            this.truthTableTestIsRunning = false
            if (runId !== this.truthTableTestRunId) {
                this.refreshCompletionState()
            }
        }
    }

    private async rebuildDynamicTruthTable(runId: number) {
        const inputs = this.placedComponents()
            .filter(comp => this.isInputComponent(comp))
            .sort((a, b) => this.componentDisplayName(a).localeCompare(this.componentDisplayName(b)))
        const outputs = this.placedComponents()
            .filter(comp => this.isOutputComponent(comp))
            .sort((a, b) => this.componentDisplayName(a).localeCompare(this.componentDisplayName(b)))

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

            const oldPropagationDelay = this.editor.options.propagationDelay
            this.editor.setPartialOptions({ ...this.editor.options, propagationDelay: 0 })
            try {
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
            } finally {
                this.editor.setPartialOptions({ ...this.editor.options, propagationDelay: oldPropagationDelay })
            }
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

    private hasOutputNamed(name: string): boolean {
        return this.placedComponents().some(comp =>
            this.isOutputComponent(comp) && comp.name === name
        )
    }

    private hasPlacedGate(gateType: string): boolean {
        return this.placedComponents().some(comp => comp instanceof GateBase && comp.type === gateType)
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

    private matchesComponent(component: Component, matcher: TutorialComponentMatcher): boolean {
        if (component.state !== ComponentState.SPAWNED) {
            return false
        }
        if ("componentType" in matcher) {
            return component.def.type === matcher.componentType
        }
        return component instanceof GateBase && component.type === matcher.gateType
    }
}