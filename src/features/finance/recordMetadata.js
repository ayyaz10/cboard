export const MAX_MILEAGE = 2_000_000;
const text = (value, max) => String(value ?? '').trim().slice(0, max);
export function isVehiclePurchaseCategory(category) {
  const name = typeof category === 'string' ? category : category?.name;
  return String(name || '').trim().toLocaleLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim() === 'vehicle purchase';
}
export function normalizeVehicleMetadata(value = {}) {
  const rawMileage = typeof value.mileage === 'string' ? value.mileage.trim() : value.mileage;
  const mileage = rawMileage === '' || rawMileage == null ? '' : Number(rawMileage);
  return { mileage: Number.isFinite(mileage) && mileage >= 0 && mileage <= MAX_MILEAGE ? mileage : '', mileageUnit: ['miles', 'km'].includes(value.mileageUnit) ? value.mileageUnit : '', registration: text(value.registration, 40), makeModel: text(value.makeModel, 120), modelYear: /^\d{4}$/.test(String(value.modelYear || '')) && Number(value.modelYear) >= 1886 && Number(value.modelYear) <= 2100 ? String(value.modelYear) : '', vin: text(value.vin, 80) };
}
export function normalizeCustomFields(value = []) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map(field => ({ id: text(field?.id, 100) || crypto.randomUUID(), label: text(field?.label, 80), type: ['text', 'number', 'date'].includes(field?.type) ? field.type : 'text', value: field?.type === 'number' && field.value !== '' && field.value != null && Number.isFinite(Number(field.value)) ? Number(field.value) : text(field?.value, 250), ...(field?.unit ? { unit: text(field.unit, 30) } : {}) }));
}
export function validateRecordMetadata(vehicle, customFields) {
  const details = normalizeVehicleMetadata(vehicle), rawMileage = typeof vehicle?.mileage === 'string' ? vehicle.mileage.trim() : vehicle?.mileage;
  if (rawMileage !== '' && rawMileage != null && (!Number.isFinite(Number(rawMileage)) || Number(rawMileage) < 0 || Number(rawMileage) > MAX_MILEAGE)) throw new Error(`Mileage must be between 0 and ${MAX_MILEAGE.toLocaleString()}.`);
  if (details.mileage !== '' && !details.mileageUnit) throw new Error('Choose miles or km for the mileage.');
  const rawYear = String(vehicle?.modelYear || '').trim();
  if (rawYear && !details.modelYear) throw new Error('Enter a valid model year from 1886 to 2100.');
  if (!Array.isArray(customFields) || customFields.length > 50) throw new Error('Use up to 50 custom fields.');
  const fields = customFields.map(field => {
    const label = text(field.label, 80), type = field.type || 'text', value = String(field.value ?? '').trim();
    if (!label) throw new Error('Every custom field needs a label.');
    if (String(field.label).trim().length > 80) throw new Error('Custom field labels must be 80 characters or fewer.');
    if (value.length > 250) throw new Error('Custom field values must be 250 characters or fewer.');
    if (!['text', 'number', 'date'].includes(type)) throw new Error('Choose Text, Number or Date for each custom field.');
    if (type === 'number' && value && !Number.isFinite(Number(value))) throw new Error(`Enter a valid number for ${label}.`);
    if (type === 'date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00`)) || new Date(`${value}T12:00:00`).toISOString().slice(0, 10) !== value)) throw new Error(`Enter a valid date for ${label}.`);
    const savedValue = type === 'number' && value ? Number(value) : value;
    return { id: text(field.id, 100) || crypto.randomUUID(), label, type, value: savedValue, ...(field.unit ? { unit: text(field.unit, 30) } : {}) };
  });
  return { vehicleMetadata: details, customFields: fields };
}
