import { useEffect, useRef, useState } from "react";
import { PageShell } from "../../components/layout/PageShell";
import { AppNavigation } from "../../components/layout/AppNavigation";
import { readGroceryImage, resizeGroceryImage } from "./groceryImage";
import { groceryImage } from "../../services/groceryService";
import { useGroceries } from "./useGroceries";
import {
  categories,
  categoryIcon,
  units,
  stockStatus,
  increment,
  round,
  parseEntry,
  addItems,
  addShopping,
  purchase,
  normalizeName,
  groceryImageFor,
  setGroceryImage,
} from "./groceryData";
import "./groceries.css";

function Thumbnail({ item, image }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  return (
    <div className="g-thumb">
      {image && !failed ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{categoryIcon(item.category)}</span>
      )}
    </div>
  );
}
function NumberEdit({ value, label, onSave }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  return (
    <input
      aria-label={label}
      className="g-number"
      type="number"
      min="0"
      step="any"
      placeholder="Set qty"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async (e) => {
        if (!e.target.validity.valid) {
          setDraft(value ?? "");
          return;
        }
        const next = draft === "" ? null : Number(draft);
        if (next !== value && (await onSave(next)) === false)
          setDraft(value ?? "");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
function Modal({ title, close, children, error }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog className="g-dialog groceries" ref={ref} onCancel={close}>
      <div className="g-between">
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={close}>
          ✕
        </button>
      </div>
      {error && (
        <p role="alert" className="g-alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
export function Groceries() {
  const {
    data,
    busy,
    error,
    setError,
    notice,
    setNotice,
    reload,
    change,
    undo,
  } = useGroceries();
  const [tab, setTab] = useState("stock"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [status, setStatus] = useState("All");
  const [selected, setSelected] = useState([]),
    [modal, setModal] = useState(null),
    [text, setText] = useState(""),
    [entries, setEntries] = useState(null),
    [edit, setEdit] = useState(null),
    [buy, setBuy] = useState([]);
  const [imageJobs, setImageJobs] = useState({});
  const search = useRef(null),
    add = useRef(null),
    activeImages = useRef(new Set());
  useEffect(() => {
    function keydown(e) {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.target.closest('input,textarea,select,[contenteditable="true"]') ||
        document.querySelector("dialog[open]")
      )
        return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      }
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        openAdd();
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  function openAdd() {
    setText("");
    setEntries(null);
    setModal("add");
  }
  async function generate(item) {
    if (activeImages.current.has(item.id)) return;
    activeImages.current.add(item.id);
    setImageJobs((j) => ({ ...j, [item.id]: "Generating…" }));
    try {
      let result = await groceryImage(item.name);
      for (let n = 0; !result.url && n < 45; n++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        result = await groceryImage(item.name, true);
      }
      if (!result.url)
        throw new Error("Still processing. Retry to check the same image.");
      const thumbnail = await resizeGroceryImage(result.url);
      // Serialize with stock saves and preserve uploads made while generating.
      let saved = false;
      for (let n = 0; !saved && n < 20; n++) {
        saved = await change(
          (s) => {
            const target = s.items.find((i) => i.id === item.id);
            if (
              target &&
              !groceryImageFor(s, target.name) &&
              target.name === item.name
            )
              setGroceryImage(s, target.name, thumbnail);
            return s;
          },
          "Image ready",
          false,
        );
        if (!saved) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      setImageJobs((j) => ({
        ...j,
        [item.id]: saved ? "" : "Image ready. Retry to save.",
      }));
    } catch (e) {
      setImageJobs((j) => ({ ...j, [item.id]: e.message }));
    } finally {
      activeImages.current.delete(item.id);
    }
  }
  function patch(id, values) {
    return change((s) => {
      if (values.name !== undefined) {
        if (!values.name.trim() || !values.category?.trim())
          throw new Error("Enter an item name and category.");
        if (
          s.items.some(
            (i) =>
              i.id !== id &&
              normalizeName(i.name) === normalizeName(values.name),
          )
        )
          throw new Error("An item with that name already exists.");
        values = {
          ...values,
          name: values.name.trim(),
          category: values.category.trim(),
        };
      }
      Object.assign(
        s.items.find((i) => i.id === id),
        values,
      );
      if (Object.hasOwn(values, "image"))
        setGroceryImage(s, values.name, values.image);
      return s;
    });
  }
  function toShop(items) {
    return change((s) => {
      for (const item of items)
        s.shopping = addShopping(
          s.shopping,
          item,
          Math.max(
            increment(item.unit),
            round(item.threshold - (item.quantity ?? 0)),
          ),
          true,
        );
      return s;
    }, "Added to shopping list");
  }
  function toggle(id) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  }
  const categoryNames = [
    ...new Set([
      ...Object.keys(categories),
      "Other",
      ...(data?.items || []).map((i) => i.category),
    ]),
  ];
  const list = data ? (tab === "stock" ? data.items : data.shopping) : [];
  const filtered = list.filter(
    (i) =>
      i.name.toLowerCase().includes(query.toLowerCase()) &&
      (category === "All" || i.category === category) &&
      (tab !== "stock" || status === "All" || stockStatus(i) === status),
  );
  function beginBuy(items) {
    setBuy(items.map((i) => ({ ...i, currentQuantity: "" })));
    setModal("buy");
  }
  async function saveEntries(e) {
    e.preventDefault();
    if (!entries) {
      try {
        setEntries(
          text
            .split(/\n/)
            .filter((t) => t.trim())
            .map(parseEntry),
        );
      } catch (e) {
        setError(e.message);
      }
      return;
    }
    if (
      await change(
        (s) => addItems(s, entries, tab === "shop"),
        tab === "shop" ? "Shopping list updated" : "Groceries added",
      )
    ) {
      setModal(null);
      if (data.settings.autoImages && tab === "stock")
        for (const item of entries)
          if (
            !data.items.some(
              (i) => normalizeName(i.name) === normalizeName(item.name),
            )
          )
            generate(item);
    }
  }
  return (
    <PageShell>
      <section className="panel groceries p-5 sm:p-8 lg:p-10">
        <AppNavigation activePath="/groceries" />
        <header className="g-between g-header">
          <div>
            <span className="g-eyebrow">YOUR EVERYDAY KITCHEN</span>
            <h1>Groceries, sorted.</h1>
            <p>What you have. What’s running low. What’s next.</p>
          </div>
          <button
            className="g-primary"
            onClick={openAdd}
            disabled={!data || busy}
          >
            ＋ Quick add <kbd>N</kbd>
          </button>
        </header>
        {error && (
          <div role="alert" className="g-alert">
            {error}{" "}
            <button disabled={busy} onClick={reload}>
              Reload groceries
            </button>
          </div>
        )}
        {!data ? (
          <p role="status">
            {busy ? "Opening your kitchen…" : "Reload to open your groceries."}
          </p>
        ) : (
          <>
            <div className="g-stats">
              {["In stock", "Low stock", "Out of stock", "Shopping list"].map(
                (label) => (
                  <button
                    key={label}
                    onClick={() => {
                      setTab(label === "Shopping list" ? "shop" : "stock");
                      setStatus(label === "Shopping list" ? "All" : label);
                      setSelected([]);
                    }}
                  >
                    <strong>
                      {label === "Shopping list"
                        ? data.shopping.length
                        : data.items.filter((i) => stockStatus(i) === label)
                            .length}
                    </strong>
                    <span>{label}</span>
                  </button>
                ),
              )}
            </div>
            <div className="g-between">
              <div className="g-tabs">
                {[
                  ["stock", "My Groceries"],
                  ["shop", "Shopping List"],
                ].map(([key, name]) => (
                  <button
                    key={key}
                    aria-pressed={tab === key}
                    onClick={() => {
                      setTab(key);
                      setSelected([]);
                      setStatus("All");
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <button onClick={() => setModal("settings")}>
                ⚙ Preferences
              </button>
            </div>
            <div className="g-tools">
              <input
                ref={search}
                aria-label="Search groceries"
                placeholder="Search your groceries…  /"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="Category filter"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option>All</option>
                {categoryNames.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              {tab === "stock" && (
                <select
                  aria-label="Stock filter"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {[
                    "All",
                    "In stock",
                    "Low stock",
                    "Out of stock",
                    "Set quantity",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="g-between">
              <label className="g-check">
                <input
                  type="checkbox"
                  checked={
                    filtered.length > 0 &&
                    filtered.every((i) => selected.includes(i.id))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? filtered.map((i) => i.id) : [],
                    )
                  }
                />
                Select visible
              </label>
              <div className="g-actions">
                {tab === "stock" ? (
                  <button
                    disabled={busy}
                    onClick={() =>
                      toShop(
                        data.items.filter((i) =>
                          ["Low stock", "Out of stock"].includes(
                            stockStatus(i),
                          ),
                        ),
                      )
                    }
                  >
                    ＋ Add all low stock
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          categoryNames
                            .map((c) => {
                              const rows = data.shopping.filter(
                                (i) => i.category === c,
                              );
                              return rows.length
                                ? `${c}\n${rows.map((i) => `☐ ${i.name} — ${i.quantity} ${i.unit}`).join("\n")}`
                                : "";
                            })
                            .filter(Boolean)
                            .join("\n\n"),
                        );
                        setNotice("Shopping list copied");
                      } catch {
                        setError(
                          "Could not access clipboard. Please allow clipboard access.",
                        );
                      }
                    }}
                  >
                    Copy list
                  </button>
                )}
              </div>
            </div>
            {selected.length > 0 && (
              <div className="g-bulk">
                <strong>{selected.length} selected</strong>
                {tab === "stock" ? (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        toShop(
                          data.items.filter((i) => selected.includes(i.id)),
                        )
                      }
                    >
                      Add to list
                    </button>
                    <select
                      aria-label="Move selected to category"
                      defaultValue=""
                      disabled={busy}
                      onChange={async (e) => {
                        const c = e.target.value;
                        if (c)
                          await change((s) => {
                            s.items.forEach((i) => {
                              if (selected.includes(i.id)) i.category = c;
                            });
                            return s;
                          });
                        e.target.value = "";
                      }}
                    >
                      <option value="">Move category…</option>
                      {categoryNames.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </>
                ) : (
                  <button
                    onClick={() =>
                      beginBuy(
                        data.shopping.filter((i) => selected.includes(i.id)),
                      )
                    }
                  >
                    Mark purchased
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await change((s) => {
                        const key = tab === "stock" ? "items" : "shopping";
                        s[key] = s[key].filter((i) => !selected.includes(i.id));
                        return s;
                      }, "Items removed")
                    )
                      setSelected([]);
                  }}
                >
                  Remove
                </button>
                <button onClick={() => setSelected([])}>Clear</button>
              </div>
            )}
            {tab === "stock" && data.items.some((i) => i.quantity == null) && (
              <p className="g-hint">
                First-time setup? Tap “Set qty” beside each item. Press Enter to
                save. Unknown quantities aren’t counted as out of stock.
              </p>
            )}
            <fieldset disabled={busy} className="g-list">
              <legend className="sr-only">
                {tab === "stock" ? "Grocery inventory" : "Shopping items"}
              </legend>
              {categoryNames.map((c) => {
                const rows = filtered.filter((i) => i.category === c);
                return rows.length ? (
                  <section key={c} className="g-group">
                    <h2>
                      {categoryIcon(c)} {c} <small>{rows.length}</small>
                    </h2>
                    {rows.map((item) => (
                      <div key={item.id} className="g-row">
                        <input
                          aria-label={`Select ${item.name}`}
                          type="checkbox"
                          checked={selected.includes(item.id)}
                          onChange={() => toggle(item.id)}
                        />
                        <Thumbnail
                          item={item}
                          image={groceryImageFor(data, item.name)}
                        />
                        <div className="g-item-name">
                          <button
                            className="g-name"
                            onClick={() => {
                              setEdit({
                                ...item,
                                image: groceryImageFor(data, item.name),
                              });
                              setModal(tab === "stock" ? "edit" : "editShop");
                            }}
                          >
                            {item.name}
                          </button>
                          <small>
                            {tab === "stock"
                              ? stockStatus(item)
                              : "To purchase"}
                            {tab === "stock" && item.location
                              ? ` · ${item.location}`
                              : ""}
                          </small>
                          {tab === "stock" &&
                            data.settings.expiryReminders &&
                            item.expiry && (
                              <small
                                className={
                                  item.expiry <=
                                  new Date().toLocaleDateString("en-CA")
                                    ? "g-expiry"
                                    : ""
                                }
                              >
                                Best before {item.expiry}
                              </small>
                            )}
                          {imageJobs[item.id] && (
                            <small>{imageJobs[item.id]}</small>
                          )}
                        </div>
                        <div className="g-quantity">
                          {tab === "stock" && (
                            <button
                              aria-label={`Use ${increment(item.unit)} ${item.unit} of ${item.name}`}
                              disabled={
                                item.quantity == null || item.quantity === 0
                              }
                              onClick={() =>
                                patch(item.id, {
                                  quantity: Math.max(
                                    0,
                                    round(item.quantity - increment(item.unit)),
                                  ),
                                })
                              }
                            >
                              −
                            </button>
                          )}
                          <NumberEdit
                            label={`${item.name} quantity`}
                            value={item.quantity}
                            onSave={(quantity) =>
                              tab === "stock"
                                ? patch(item.id, { quantity })
                                : change((s) => {
                                    s.shopping.find(
                                      (i) => i.id === item.id,
                                    ).quantity = quantity ?? 1;
                                    return s;
                                  })
                            }
                          />
                          <span>{item.unit}</span>
                          {tab === "stock" && (
                            <button
                              aria-label={`Restock ${item.name} by ${increment(item.unit)} ${item.unit}`}
                              disabled={item.quantity == null}
                              onClick={() =>
                                patch(item.id, {
                                  quantity: round(
                                    item.quantity + increment(item.unit),
                                  ),
                                })
                              }
                            >
                              ＋
                            </button>
                          )}
                        </div>
                        <div className="g-row-actions">
                          {tab === "stock" ? (
                            <>
                              <button
                                aria-label={`Add ${item.name} to shopping list`}
                                onClick={() => toShop([item])}
                              >
                                ＋ List
                              </button>
                              <button
                                aria-label={`Edit ${item.name}`}
                                onClick={() => {
                                  setEdit({
                                    ...item,
                                    image: groceryImageFor(data, item.name),
                                  });
                                  setModal("edit");
                                }}
                              >
                                Edit
                              </button>
                            </>
                          ) : (
                            <button onClick={() => beginBuy([item])}>
                              ✓ Bought
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </section>
                ) : null;
              })}
            </fieldset>
            {!filtered.length && (
              <div className="g-empty">
                <span>🛒</span>
                <h2>
                  {query || category !== "All" || status !== "All"
                    ? "No matching items"
                    : tab === "shop"
                      ? "Your shopping list is clear"
                      : "Make room for something good"}
                </h2>
                <p>
                  {tab === "shop"
                    ? "Add what you need, or bring over your low-stock items."
                    : "Add your first grocery or adjust your filters."}
                </p>
                <button onClick={openAdd}>＋ Add an item</button>
              </div>
            )}
            <div className="g-footer" role="status">
              <span>
                {busy
                  ? "Saving…"
                  : notice || `${list.length} items · Saved to your account`}
              </span>
              {undo && (
                <button disabled={busy} onClick={undo}>
                  Undo
                </button>
              )}
              <small>/ Search · N Add · Enter Save</small>
            </div>
          </>
        )}
        {modal === "add" && (
          <Modal
            error={error}
            title={
              tab === "shop" ? "Add to shopping list" : "Quick add groceries"
            }
            close={() => setModal(null)}
          >
            <form onSubmit={saveEntries}>
              <p>Type one item per line. We’ll fill in the details for you.</p>
              <textarea
                autoFocus
                ref={add}
                rows={4}
                required
                placeholder={"6 bananas\n500 g chicken breast\n2 L milk"}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setEntries(null);
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === "Enter")
                    e.currentTarget.form.requestSubmit();
                }}
              />
              {!entries && data && (
                <div className="g-suggestions">
                  {data.items
                    .filter(
                      (i) =>
                        text.trim() &&
                        i.name
                          .toLowerCase()
                          .includes(text.trim().toLowerCase()),
                    )
                    .slice(0, 5)
                    .map((i) => (
                      <button
                        type="button"
                        key={i.id}
                        onClick={() => setText(i.name)}
                      >
                        {i.name}
                      </button>
                    ))}
                </div>
              )}
              {entries?.map((item, index) => (
                <div key={item.id} className="g-preview">
                  <input
                    aria-label="Item name"
                    required
                    value={item.name}
                    onChange={(e) =>
                      setEntries((a) =>
                        a.map((i, n) =>
                          n === index ? { ...i, name: e.target.value } : i,
                        ),
                      )
                    }
                  />
                  <input
                    aria-label={`${item.name} amount`}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Set later"
                    value={item.quantity ?? ""}
                    onChange={(e) =>
                      setEntries((a) =>
                        a.map((i, n) =>
                          n === index
                            ? {
                                ...i,
                                quantity:
                                  e.target.value === ""
                                    ? null
                                    : Number(e.target.value),
                              }
                            : i,
                        ),
                      )
                    }
                  />
                  <select
                    aria-label={`${item.name} unit`}
                    value={item.unit}
                    onChange={(e) =>
                      setEntries((a) =>
                        a.map((i, n) =>
                          n === index ? { ...i, unit: e.target.value } : i,
                        ),
                      )
                    }
                  >
                    {units.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                  <select
                    aria-label={`${item.name} category`}
                    value={item.category}
                    onChange={(e) =>
                      setEntries((a) =>
                        a.map((i, n) =>
                          n === index ? { ...i, category: e.target.value } : i,
                        ),
                      )
                    }
                  >
                    {categoryNames.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  {data.items.some(
                    (i) => normalizeName(i.name) === normalizeName(item.name),
                  ) && (
                    <small>
                      Already in your kitchen — this amount will be added to
                      existing stock.
                    </small>
                  )}
                </div>
              ))}
              <button className="g-primary" disabled={busy || !text.trim()}>
                {entries
                  ? `Save ${entries.length} item${entries.length === 1 ? "" : "s"}`
                  : "Review items →"}
              </button>
            </form>
          </Modal>
        )}
        {(modal === "edit" || modal === "editShop") && edit && (
          <Modal error={error} title={edit.name} close={() => setModal(null)}>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await change((s) => {
                    if (!edit.name.trim() || !edit.category.trim())
                      throw new Error("Enter an item name and category.");
                    if (modal === "editShop" && !(edit.quantity > 0))
                      throw new Error(
                        "Enter a shopping quantity greater than zero.",
                      );
                    const key = modal === "edit" ? "items" : "shopping";
                    const previous = s[key].find((i) => i.id === edit.id);
                    if (
                      s[key].some(
                        (i) =>
                          i.id !== edit.id &&
                          normalizeName(i.name) === normalizeName(edit.name),
                      )
                    )
                      throw new Error("An item with that name already exists.");
                    const cleanEdit = {
                      ...edit,
                      name: edit.name.trim(),
                      category: edit.category.trim(),
                    };
                    delete cleanEdit.image;
                    s[key] = s[key].map((i) =>
                      i.id === edit.id
                        ? cleanEdit
                        : i,
                    );
                    if (modal === "edit") {
                      if (
                        previous &&
                        normalizeName(previous.name) !==
                          normalizeName(cleanEdit.name)
                      )
                        setGroceryImage(s, previous.name, null);
                      setGroceryImage(s, cleanEdit.name, edit.image || null);
                    }
                    return s;
                  })
                )
                  setModal(null);
              }}
            >
              <label>
                Name
                <input
                  required
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </label>
              <div className="g-tools">
                <label>
                  Quantity
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={edit.quantity ?? ""}
                    placeholder="Not set"
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        quantity:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Unit
                  <select
                    value={edit.unit}
                    onChange={(e) =>
                      setEdit({ ...edit, unit: e.target.value, quantity: null })
                    }
                  >
                    {units.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="g-hint">
                Changing the unit clears the quantity so you can enter the
                correct amount.
              </p>
              <label>
                Category
                <input
                  list="g-categories"
                  required
                  value={edit.category}
                  onChange={(e) =>
                    setEdit({ ...edit, category: e.target.value })
                  }
                />
              </label>
              <datalist id="g-categories">
                {categoryNames.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {modal === "edit" && (
                <>
                  <div className="g-actions">
                    <button
                      type="button"
                      disabled={edit.quantity == null}
                      onClick={() => {
                        setEdit({ ...edit, adjustment: "", operation: "Use" });
                      }}
                    >
                      Use amount
                    </button>
                    <button
                      type="button"
                      disabled={edit.quantity == null}
                      onClick={() => {
                        setEdit({
                          ...edit,
                          adjustment: "",
                          operation: "Restock",
                        });
                      }}
                    >
                      Restock
                    </button>
                  </div>
                  {edit.operation && (
                    <div className="g-tools">
                      <label>
                        {edit.operation} ({edit.unit})
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={edit.adjustment}
                          onChange={(e) =>
                            setEdit({ ...edit, adjustment: e.target.value })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        disabled={
                          !edit.adjustment ||
                          Number(edit.adjustment) < 0 ||
                          (edit.operation === "Use" &&
                            Number(edit.adjustment) > edit.quantity)
                        }
                        onClick={() =>
                          setEdit({
                            ...edit,
                            quantity: round(
                              edit.quantity +
                                Number(edit.adjustment) *
                                  (edit.operation === "Use" ? -1 : 1),
                            ),
                            operation: null,
                          })
                        }
                      >
                        Apply
                      </button>
                    </div>
                  )}
                  <details>
                    <summary>More details & photo</summary>
                    <label>
                      Low-stock alert at ({edit.unit})
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={edit.threshold}
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            threshold: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Best-before date
                      <input
                        type="date"
                        value={edit.expiry}
                        onChange={(e) =>
                          setEdit({ ...edit, expiry: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Storage location
                      <input
                        placeholder="Fridge, freezer, pantry…"
                        value={edit.location}
                        onChange={(e) =>
                          setEdit({ ...edit, location: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Item photo
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={async (e) => {
                          const file = e.target.files[0];
                          if (!file) return;
                          try {
                            const image = await readGroceryImage(file);
                            setEdit((previous) =>
                              previous?.id === edit.id
                                ? { ...previous, image }
                                : previous,
                            );
                          } catch (e) {
                            setError(e.message);
                          }
                        }}
                      />
                    </label>
                    {edit.image && (
                      <>
                        <img
                          className="g-photo"
                          src={edit.image}
                          alt={edit.name}
                        />
                        <button
                          type="button"
                          onClick={() => setEdit({ ...edit, image: null })}
                        >
                          Remove photo
                        </button>
                      </>
                    )}
                    {!edit.image && (
                      <button
                        type="button"
                        disabled={activeImages.current.has(edit.id)}
                        onClick={async (e) => {
                          if (!e.currentTarget.form.reportValidity()) return;
                          if (await patch(edit.id, edit)) {
                            generate({ ...edit, name: edit.name.trim() });
                            setModal(null);
                          }
                        }}
                      >
                        Generate / retry image
                      </button>
                    )}
                  </details>
                </>
              )}
              <div className="g-between">
                <button className="g-primary" disabled={busy}>
                  Save changes
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await change((s) => {
                        const key = modal === "edit" ? "items" : "shopping";
                        s[key] = s[key].filter((i) => i.id !== edit.id);
                        return s;
                      }, "Item removed")
                    )
                      setModal(null);
                  }}
                >
                  Remove item
                </button>
              </div>
            </form>
          </Modal>
        )}
        {modal === "buy" && (
          <Modal
            error={error}
            title="Bring it into your kitchen"
            close={() => setModal(null)}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await change(
                    (s) => purchase(s, buy),
                    "Purchased items added to stock",
                  )
                ) {
                  setModal(null);
                  setSelected([]);
                }
              }}
            >
              <p>
                Confirm what you actually bought. These amounts will be added to
                your current stock.
              </p>
              {buy.map((item, index) => (
                <div key={item.id}>
                  {data.items.find(
                    (i) => normalizeName(i.name) === normalizeName(item.name),
                  )?.quantity === null && (
                    <label>
                      How much {item.name} did you have before shopping? (
                      {
                        data.items.find(
                          (i) =>
                            normalizeName(i.name) === normalizeName(item.name),
                        ).unit
                      }
                      )
                      <input
                        type="number"
                        min="0"
                        step="any"
                        required
                        placeholder="Enter 0 if none left"
                        value={item.currentQuantity}
                        onChange={(e) =>
                          setBuy((a) =>
                            a.map((i, n) =>
                              n === index
                                ? {
                                    ...i,
                                    currentQuantity:
                                      e.target.value === ""
                                        ? ""
                                        : Number(e.target.value),
                                  }
                                : i,
                            ),
                          )
                        }
                      />
                    </label>
                  )}
                  <label>
                    {item.name} bought ({item.unit})
                    <input
                      type="number"
                      min="0.0001"
                      step="any"
                      required
                      value={item.quantity}
                      onChange={(e) =>
                        setBuy((a) =>
                          a.map((i, n) =>
                            n === index
                              ? { ...i, quantity: Number(e.target.value) }
                              : i,
                          ),
                        )
                      }
                    />
                  </label>
                </div>
              ))}
              <button className="g-primary" disabled={busy}>
                Confirm purchase
              </button>
            </form>
          </Modal>
        )}
        {modal === "settings" && (
          <Modal
            error={error}
            title="Kitchen preferences"
            close={() => setModal(null)}
          >
            <label className="g-check">
              <input
                disabled={busy}
                type="checkbox"
                checked={data.settings.expiryReminders}
                onChange={(e) =>
                  change((s) => {
                    s.settings.expiryReminders = e.target.checked;
                    return s;
                  })
                }
              />
              Show best-before reminders
            </label>
            <label className="g-check">
              <input
                disabled={busy}
                type="checkbox"
                checked={data.settings.autoImages}
                onChange={(e) =>
                  change((s) => {
                    s.settings.autoImages = e.target.checked;
                    return s;
                  })
                }
              />
              Generate photos for new groceries
            </label>
            <label>
              Monthly image allowance (USD)
              <NumberEdit
                label="Monthly image allowance in USD"
                value={data.settings.imageLimit}
                onSave={(value) =>
                  change((s) => {
                    s.settings.imageLimit = value ?? 0;
                    return s;
                  })
                }
              />
            </label>
            <p>
              Photos use Cloudflare FLUX.1 Schnell. Set an allowance above $0
              after connecting Cloudflare. This limits image requests; actual
              charges depend on your Cloudflare plan and free usage. Uploads are
              always available.
            </p>
          </Modal>
        )}
      </section>
    </PageShell>
  );
}
