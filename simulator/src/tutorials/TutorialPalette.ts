// simulator/src/TutorialPalette.ts
import { LogicEditor } from "../LogicEditor"
import { button, cls, div, span, type } from "../htmlgen"
import { setVisible } from "../utils"
import { TutorialContent, TutorialContentBlock, TutorialImageBlock, TutorialParagraphBlock, TutorialTruthTableBlock } from "./TutorialContent"

class TutorialStep {
    public constructor(
        public readonly content: TutorialContentBlock[],
    ) { }
}

export class TutorialPalette {
    public readonly rootElem: HTMLDivElement
    private readonly content: TutorialContent
    private readonly nextButton: HTMLButtonElement
    private readonly previousButton: HTMLButtonElement
    private readonly pageCounter: HTMLSpanElement
    private currentStep = 0

    /** Tutorial steps */
    private readonly step0: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock("Bienvenue dans ce premier TP !"),
        new TutorialParagraphBlock("Dans celui-ci, tu vas construire ton premier circuit : Y = A̅."),
    ])
    private readonly step1: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock('Glisser-déposer l’objet "in" sur le canevas.'),
        new TutorialImageBlock("simulator/img/Input1.svg", "Symbole d’entrée", "Objet in"),
    ])
    private readonly step2: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock('Glisser-déposer l’objet "not" sur le canevas.'),
        new TutorialImageBlock("simulator/img/not.svg", "Porte logique NON", "Porte not"),
    ])
    private readonly step3: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock('Relier l’objet "in" et l’objet "not".'),
    ])
    private readonly step4: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock('Glisser-déposer l’objet "out" sur le canevas.'),
        new TutorialImageBlock("simulator/img/Output1.svg", "Symbole de sortie", "Objet out"),
    ])
    private readonly step5: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock('Relier la porte "not" et l’objet "out".'),
    ])
    private readonly step6: TutorialStep = new TutorialStep([
        new TutorialParagraphBlock("Voici la table de vérité de la fonction not."),
        new TutorialTruthTableBlock(
            ["A", "Y = A̅"],
            () => [
                [0, 1],
                [1, 0],
            ],
        ),
        new TutorialParagraphBlock("Cliquer sur input : output doit changer. Vérifier les résultats avec la table de vérité."),
    ])

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

        this.rootElem = div(cls("tutorial-palette sim-toolbar-right"),
            div(cls("tutorial-heading"),
                div(cls("tutorial-title"),
                    "TP : Dessinez le circuit Y = A̅",
                ),
                close,
            ),
            this.content.rootElem,
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
    }

    private goToNextStep() {
        if (this.currentStep < this.steps.length - 1) {
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

    private updateDisplayedStep() {
        this.content.setBlocks(this.steps[this.currentStep].content)
        this.pageCounter.textContent = `Etape ${this.currentStep + 1} / ${this.steps.length}`
        setVisible(this.nextButton, this.currentStep < this.steps.length - 1)
        setVisible(this.previousButton, this.currentStep > 0)
    }
}