/**
 * Editor enriquecido propio sobre `contentEditable` (sin librerías) para el
 * cuerpo de un correo: negrita, cursiva, subrayado, listas y enlace. Lo usa el
 * paso «Contenido» del modal «Enviar correo» del vehículo, donde antes había
 * un `<textarea>` que enseñaba el HTML en crudo; el editor de Ajustes →
 * Plantillas tiene el suyo (con encabezado, imagen y Drive), del que este es
 * la versión corta.
 *
 * `value` es el HTML que la caja enseña mientras nadie la toca: se vuelca al
 * DOM solo cuando cambia desde fuera y la caja NO tiene el foco (si se
 * reescribiera en cada tecla, el cursor saltaría al principio). Lo tecleado
 * sale por `onChange` con el HTML de la caja tal cual; el saneado es del
 * servidor (nh3), como en el editor de plantillas. `insertText` pega texto
 * donde esté el cursor (los marcadores `{{…}}` de la tira de variables).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Bold, Italic, Link2, List, ListOrdered, Underline } from 'lucide-react'

import { useEmailTemplatesCopy } from '../translations/emailTemplates.ts'

export interface RichTextEditorHandle {
  /** Pega texto donde esté el cursor (o al final si la caja no lo tiene). */
  insertText: (text: string) => void
  focus: () => void
}

interface Props {
  value: string
  onChange: (html: string) => void
  'aria-label': string
  /** Lo que se lee con la caja vacía. */
  placeholder?: string
  id?: string
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  { value, onChange, placeholder, id, 'aria-label': ariaLabel },
  ref,
) {
  const t = useEmailTemplatesCopy()
  const box = useRef<HTMLDivElement>(null)
  // Dónde dejó el cursor quien escribe (se apunta al teclear o al hacer
  // clic): es donde se pega un marcador. Sin ninguno —nadie ha tocado la
  // caja—, al final: `focus()` solo pondría el cursor al principio.
  const caret = useRef<Range | null>(null)

  // Lo que viene de fuera entra solo si la caja no está en uso y es distinto
  // de lo que ya enseña: así el cursor no se mueve mientras se escribe.
  useEffect(() => {
    const el = box.current
    if (!el || document.activeElement === el) return
    if (el.innerHTML !== value) {
      el.innerHTML = value
      caret.current = null
    }
  }, [value])

  const sync = () => onChange(box.current?.innerHTML ?? '')

  function remember() {
    const el = box.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (el.contains(range.startContainer)) caret.current = range.cloneRange()
  }

  /** Comando de formato del navegador. Sin él (jsdom), la caja se queda igual. */
  function exec(command: string, arg?: string) {
    const el = box.current
    if (!el) return
    el.focus()
    if (typeof document.execCommand === 'function') document.execCommand(command, false, arg)
    sync()
  }

  function insertText(text: string) {
    const el = box.current
    if (!el) return
    el.focus()
    const sel = window.getSelection()
    const guardado = caret.current
    let range: Range | null =
      guardado && guardado.startContainer.isConnected && el.contains(guardado.startContainer)
        ? guardado
        : null
    if (!range) {
      range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
    }
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    // El cursor se queda tras lo pegado, listo para seguir escribiendo.
    range.setStartAfter(node)
    range.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(range)
    caret.current = range.cloneRange()
    sync()
  }

  useImperativeHandle(ref, () => ({ insertText, focus: () => box.current?.focus() }))

  function link() {
    const url = window.prompt(t.promptLinkUrl)
    if (url && /^https?:\/\//i.test(url)) exec('createLink', url)
  }

  // `onMouseDown` con `preventDefault`: el botón no se lleva el foco ni la
  // selección de la caja, que es sobre lo que actúa el comando.
  const tool = (title: string, icon: React.ReactNode, run: () => void) => (
    <button type="button" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {icon}
    </button>
  )

  return (
    <div className="rich-editor">
      <div className="editor-toolbar rich-editor-toolbar" role="toolbar" aria-label={t.toolbarLabel}>
        {tool(t.bold, <Bold size={15} />, () => exec('bold'))}
        {tool(t.italic, <Italic size={15} />, () => exec('italic'))}
        {tool(t.underline, <Underline size={15} />, () => exec('underline'))}
        {tool(t.list, <List size={15} />, () => exec('insertUnorderedList'))}
        {tool(t.orderedList, <ListOrdered size={15} />, () => exec('insertOrderedList'))}
        {tool(t.link, <Link2 size={15} />, link)}
      </div>
      <div
        ref={box}
        id={id}
        className="editor-body rich-editor-body"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={() => {
          remember()
          sync()
        }}
        onKeyUp={remember}
        onMouseUp={remember}
        onBlur={sync}
      />
    </div>
  )
})
