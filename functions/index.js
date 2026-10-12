const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore();

async function requireManager(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول أولاً');
  const snap = await db.collection('users').doc(request.auth.uid).get();
  if (!snap.exists || snap.data().role !== 'manager' || snap.data().active !== true) {
    throw new HttpsError('permission-denied', 'هذه العملية للمدير فقط');
  }
}


// Repair a legacy profile stored under a non-UID document ID, but only for the
// authenticated account whose email exactly matches the existing active profile.
exports.repairMyProfile = onCall(async (request) => {
  if (!request.auth || !request.auth.uid || !request.auth.token.email) {
    throw new HttpsError('unauthenticated', 'سجّل الدخول أولاً');
  }
  const uid = request.auth.uid;
  const email = String(request.auth.token.email).trim().toLowerCase();
  const canonicalRef = db.collection('users').doc(uid);
  const canonical = await canonicalRef.get();
  if (canonical.exists) return { repaired: false };
  const matches = await db.collection('users').where('email', '==', request.auth.token.email).limit(5).get();
  const valid = matches.docs.filter(doc => {
    const data = doc.data();
    return String(data.email || '').trim().toLowerCase() === email && data.active === true &&
      ['manager', 'coach'].includes(data.role);
  });
  if (valid.length !== 1) throw new HttpsError('not-found', 'لم أجد ملف صلاحيات نشطًا واحدًا مطابقًا لبريد الحساب');
  const oldDoc = valid[0];
  if (oldDoc.id === uid) return { repaired: false };
  const profile = oldDoc.data();
  const batch = db.batch();
  batch.set(canonicalRef, { ...profile, email: request.auth.token.email, repairedAt: FieldValue.serverTimestamp() });
  batch.delete(oldDoc.ref);
  await batch.commit();
  return { repaired: true, role: profile.role };
});

// First-run bootstrap: only the first manager can be created without an existing manager.
exports.getBootstrapStatus = onCall(async () => {
  const lock = await db.collection('system').doc('bootstrap').get();
  if (lock.exists && lock.data().initialized === true) return { initialized: true };
  const managers = await db.collection('users').where('role', '==', 'manager').limit(1).get();
  return { initialized: !managers.empty };
});

exports.bootstrapManager = onCall(async (request) => {
  const { name, email, password } = request.data || {};
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim() ||
      typeof password !== 'string' || password.length < 6) {
    throw new HttpsError('invalid-argument', 'الاسم والبريد وكلمة مرور من 6 أحرف على الأقل مطلوبة');
  }
  const lockRef = db.collection('system').doc('bootstrap');
  const managers = await db.collection('users').where('role', '==', 'manager').limit(1).get();
  if (!managers.empty) throw new HttpsError('already-exists', 'تم إعداد حساب المدير بالفعل');
  await db.runTransaction(async (tx) => {
    const lock = await tx.get(lockRef);
    if (lock.exists && lock.data().initialized === true) {
      throw new HttpsError('already-exists', 'تم إعداد حساب المدير بالفعل');
    }
    tx.set(lockRef, { initialized: true, startedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  let user;
  try {
    user = await getAuth().createUser({ email: email.trim(), password, displayName: name.trim(), disabled: false });
    await db.collection('users').doc(user.uid).set({
      role: 'manager', active: true, name: name.trim(), email: email.trim(),
      createdAt: FieldValue.serverTimestamp(), createdBy: 'first-run-bootstrap'
    });
    await lockRef.set({ initialized: true, managerUid: user.uid, completedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { uid: user.uid, email: user.email };
  } catch (e) {
    if (user?.uid) await getAuth().deleteUser(user.uid).catch(() => {});
    await lockRef.set({ initialized: false }, { merge: true }).catch(() => {});
    if (e instanceof HttpsError) throw e;
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'البريد الإلكتروني مستخدم بالفعل');
    throw new HttpsError('internal', 'تعذر إنشاء حساب المدير؛ حاول مرة أخرى');
  }
});

exports.createCoach = onCall(async (request) => {
  await requireManager(request);
  const { name, email, password, phone = '', teamId } = request.data || {};
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim() ||
      typeof password !== 'string' || password.length < 6 || typeof teamId !== 'string' || !teamId) {
    throw new HttpsError('invalid-argument', 'الاسم والبريد وكلمة المرور والفريق مطلوبة');
  }
  const teamRef = db.collection('teams').doc(teamId);
  const team = await teamRef.get();
  if (!team.exists) throw new HttpsError('not-found', 'الفريق غير موجود');
  let user;
  try { user = await getAuth().createUser({ email: email.trim(), password, displayName: name.trim(), disabled: false }); }
  catch (e) { throw new HttpsError('already-exists', 'تعذر إنشاء الحساب؛ ربما البريد مستخدم بالفعل'); }
  try {
    const batch = db.batch();
    batch.set(db.collection('users').doc(user.uid), {
      role: 'coach', active: true, name: name.trim(), email: email.trim(), phone: String(phone || '').trim(),
      teamId, createdAt: FieldValue.serverTimestamp(), createdBy: request.auth.uid
    });
    batch.set(teamRef, { coachId: user.uid }, { merge: true });
    await batch.commit();
    return { uid: user.uid, email: user.email };
  } catch (e) {
    await getAuth().deleteUser(user.uid).catch(() => {});
    throw new HttpsError('internal', 'تعذر حفظ صلاحيات الكابتن');
  }
});

exports.deleteCoach = onCall(async (request) => {
  await requireManager(request);
  const uid = request.data && request.data.uid;
  if (typeof uid !== 'string' || !uid) throw new HttpsError('invalid-argument', 'معرّف الكابتن مطلوب');
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists || snap.data().role !== 'coach') throw new HttpsError('not-found', 'حساب الكابتن غير موجود');
  const batch = db.batch();
  batch.delete(ref);
  const teams = await db.collection('teams').where('coachId', '==', uid).get();
  teams.docs.forEach(doc => batch.set(doc.ref, { coachId: '' }, { merge: true }));
  await batch.commit();
  await getAuth().deleteUser(uid).catch(() => {});
  return { ok: true };
});
