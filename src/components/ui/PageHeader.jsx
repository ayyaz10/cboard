export function PageHeader({ eyebrow, title, description, actions, className = '' }) {
  return <header className={`ui-page-header ${className}`}>
    <div className="ui-page-header__copy">{eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="ui-page-description">{description}</p>}</div>
    {actions && <div className="ui-page-header__actions">{actions}</div>}
  </header>;
}

export function SectionHeader({ title, description, actions, className = '' }) {
  return <header className={`ui-section-header ${className}`}><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div>{actions}</div>}</header>;
}
