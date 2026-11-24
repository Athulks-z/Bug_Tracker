import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import Underline from '@tiptap/extension-underline'

export default function RichTextEditor({ value, onChange, label }) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] })
    ],
    content: value || '',
    onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getHTML())
  })

  useEffect(() => {
    if (editor && value !== editor.getHTML() && !editor.isFocused) {
      editor.commands.setContent(value || '', false)
    }
  }, [value, editor])

  if (!editor) return null

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('Enter link URL', previousUrl || '')
    if (url === null) return
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  const button = (title, icon, active, action) => (
    <button type="button" title={title} aria-label={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
      style={{
        border: active ? '1px solid #378add' : '1px solid #e2e8f0',
        background: active ? '#eff6ff' : '#fff',
        borderRadius:6, minWidth:32, height:32, color:'#334155'
      }}>
      <i className={icon} />
    </button>
  )

  return (
    <div>
      {label && <label className="form-label" style={{ display:'block', marginBottom:8 }}>{label}</label>}
      <div style={{ border:'1px solid #e2e8f0', borderRadius:8, overflow:'hidden' }}>
        <div role="toolbar" aria-label="Text formatting"
          style={{ display:'flex', gap:4, flexWrap:'wrap', padding:8, background:'#f8fafc', borderBottom:'1px solid #eef2f6' }}>
          {button('Heading 1', 'ti ti-h-1', editor.isActive('heading', { level:1 }), () => editor.chain().focus().toggleHeading({ level:1 }).run())}
          {button('Heading 2', 'ti ti-h-2', editor.isActive('heading', { level:2 }), () => editor.chain().focus().toggleHeading({ level:2 }).run())}
          {button('Heading 3', 'ti ti-h-3', editor.isActive('heading', { level:3 }), () => editor.chain().focus().toggleHeading({ level:3 }).run())}
          {button('Bold', 'ti ti-bold', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
          {button('Italic', 'ti ti-italic', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
          {button('Underline', 'ti ti-underline', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run())}
          {button('Align left', 'ti ti-align-left', editor.isActive({ textAlign:'left' }), () => editor.chain().focus().setTextAlign('left').run())}
          {button('Align center', 'ti ti-align-center', editor.isActive({ textAlign:'center' }), () => editor.chain().focus().setTextAlign('center').run())}
          {button('Align right', 'ti ti-align-right', editor.isActive({ textAlign:'right' }), () => editor.chain().focus().setTextAlign('right').run())}
          {button('Justify', 'ti ti-align-justified', editor.isActive({ textAlign:'justify' }), () => editor.chain().focus().setTextAlign('justify').run())}
          {button('Bulleted list', 'ti ti-list', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}
          {button('Numbered list', 'ti ti-list-numbers', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
          {button('Indent', 'ti ti-indent-increase', false, () => editor.chain().focus().sinkListItem('listItem').run())}
          {button('Outdent', 'ti ti-indent-decrease', false, () => editor.chain().focus().liftListItem('listItem').run())}
          {button('Link', 'ti ti-link', editor.isActive('link'), setLink)}
          {button('Clear formatting', 'ti ti-clear-formatting', false, () => editor.chain().focus().unsetAllMarks().clearNodes().run())}
        </div>
        <EditorContent editor={editor} style={{ minHeight:180, maxHeight:320, overflowY:'auto', padding:12 }} />
      </div>
    </div>
  )
}
