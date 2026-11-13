import test from 'node:test';
import assert from 'node:assert/strict';
import { initialFinanceState, normalizeFinanceState } from './financeData.js';
import { isVehiclePurchaseCategory, normalizeCustomFields, normalizeVehicleMetadata, validateRecordMetadata } from './recordMetadata.js';

test('vehicle category recognition tolerates spacing and case', () => {
  assert.equal(isVehiclePurchaseCategory({ name: '  VEHICLE   Purchase ' }), true);
  assert.equal(isVehiclePurchaseCategory('Transport'), false);
});

test('vehicle metadata preserves mileage units and validates bounds', () => {
  assert.deepEqual(validateRecordMetadata({ mileage: '82450', mileageUnit: 'miles', registration: ' AB12 CDE ' }, []).vehicleMetadata, { mileage: 82450, mileageUnit: 'miles', registration: 'AB12 CDE', makeModel: '', modelYear: '', vin: '' });
  assert.throws(() => validateRecordMetadata({ mileage: 10 }, []), /Choose miles or km/);
  assert.throws(() => validateRecordMetadata({ mileage: 2_000_001, mileageUnit: 'km' }, []), /Mileage must be/);
});

test('custom field IDs, order, supported values and limits are retained', () => {
  const fields = [{ id: 'one', label: 'Invoice number', type: 'text', value: ' INV-001 ' }, { id: 'two', label: 'Warranty expiry', type: 'date', value: '2027-11-14' }];
  assert.deepEqual(normalizeCustomFields(fields), [{ ...fields[0], value: 'INV-001' }, fields[1]]);
  assert.deepEqual(validateRecordMetadata({}, fields).customFields.map(field => field.id), ['one', 'two']);
  assert.equal(validateRecordMetadata({}, [{ id: 'mileage', label: 'Mileage', type: 'number', value: '82450.5' }]).customFields[0].value, 82450.5);
  assert.throws(() => validateRecordMetadata({}, [{ label: '', type: 'text', value: '' }]), /needs a label/);
  assert.throws(() => validateRecordMetadata({}, [{ label: 'Count', type: 'number', value: 'nope' }]), /valid number/);
});

test('Finance normalization and JSON backup round trip keep record metadata and old records load empty', () => {
  const state = initialFinanceState();
  state.transactions.push({ id: 'car', type: 'expense', amount: 227500, categoryId: 'vehicle', vehicleMetadata: { mileage: 82450, mileageUnit: 'km', registration: 'AB12 CDE' }, customFields: [{ id: 'invoice', label: 'Invoice', type: 'text', value: 'INV-001' }] });
  state.creditAgreements.push({ id: 'agreement', title: 'Car', vehicleMetadata: { mileage: 82450, mileageUnit: 'miles' }, customFields: [{ id: 'expiry', label: 'Warranty expiry', type: 'date', value: '2027-11-14' }] });
  const restored = normalizeFinanceState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.transactions[0].vehicleMetadata.mileageUnit, 'km');
  assert.equal(restored.transactions[0].customFields[0].id, 'invoice');
  assert.equal(restored.creditAgreements[0].customFields[0].id, 'expiry');
  const legacy = normalizeFinanceState({ transactions: [{ id: 'old', type: 'expense', amount: 100, date: '2026-01-01' }] });
  assert.deepEqual(legacy.transactions[0].vehicleMetadata, { mileage: '', mileageUnit: '', registration: '', makeModel: '', modelYear: '', vin: '' });
  assert.deepEqual(legacy.transactions[0].customFields, []);
});
