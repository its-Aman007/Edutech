import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import multer from 'multer';
import swaggerUi from 'swagger-ui-express';

const app = express();
const upload = multer({ dest: 'uploads/' });
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173,https://workshopedu.netlify.app')
	.split(',')
	.map(origin => origin.trim().replace(/\/$/, ''))
	.filter(Boolean);

app.use(cors({
	origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
			callback(new Error(`CORS blocked origin: ${origin}`));
    }
  },
  credentials: true
}));
app.use(express.json());

const userSchema = new mongoose.Schema({ name: String, email: { type: String, unique: true }, password: String, role: { type: String, enum: ['admin','manager','member'], default: 'member' }, avatar: String }, { timestamps: true });
const projectSchema = new mongoose.Schema({ name: String, description: String, color: String, deadline: Date, manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] }, { timestamps: true });
const taskSchema = new mongoose.Schema({ title: String, description: String, status: { type: String, enum: ['todo','progress','completed'], default: 'todo' }, priority: { type: String, enum: ['low','medium','high'], default: 'medium' }, dueDate: Date, project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' }, assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, comments: [{ author: String, body: String, createdAt: { type: Date, default: Date.now } }], attachments: [{ name: String, path: String }] }, { timestamps: true });
const auditSchema = new mongoose.Schema({ action: String, entity: String, entityId: String, actor: String, details: String }, { timestamps: true });
const User = mongoose.model('User', userSchema); const Project = mongoose.model('Project', projectSchema); const Task = mongoose.model('Task', taskSchema); const Audit = mongoose.model('Audit', auditSchema);

const sign = user => jwt.sign({ id: user._id, role: user.role, name: user.name, email: user.email }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '2d' });
const auth = async (req, res, next) => { try { const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return res.status(401).json({ message: 'Authentication required' }); req.user = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret'); next(); } catch { res.status(401).json({ message: 'Invalid or expired token' }); } };
const roles = (...allowed) => (req, res, next) => allowed.includes(req.user.role) ? next() : res.status(403).json({ message: 'Insufficient permissions' });
const audit = (action, entity, req, entityId, details = '') => Audit.create({ action, entity, entityId, actor: req.user.email, details }).catch(() => {});

app.get('/api/health', (_, res) => res.json({ status: 'ok', service: 'orbit-workspace-api' }));
app.post('/api/auth/register', async (req, res) => { try { const { name, email, password, role = 'member' } = req.body; if (!name || !email || !password || password.length < 8) return res.status(400).json({ message: 'Name, email, and an 8-character password are required' }); if (await User.findOne({ email })) return res.status(409).json({ message: 'Email is already registered' }); const user = await User.create({ name, email: email.toLowerCase(), password: await bcrypt.hash(password, 12), role: role === 'admin' ? 'member' : role }); res.status(201).json({ token: sign(user), user: { id: user._id, name: user.name, email: user.email, role: user.role } }); } catch (e) { res.status(500).json({ message: e.message }); } });
app.post('/api/auth/login', async (req, res) => { const user = await User.findOne({ email: req.body.email?.toLowerCase() }); if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) return res.status(401).json({ message: 'Invalid email or password' }); res.json({ token: sign(user), user: { id: user._id, name: user.name, email: user.email, role: user.role } }); });
app.get('/api/users', auth, async (_, res) => res.json(await User.find().select('-password').sort('name')));

app.get('/api/projects', auth, async (req, res) => { const { search = '', page = 1, limit = 12 } = req.query; const query = { name: { $regex: search, $options: 'i' } }; const [items, total] = await Promise.all([Project.find(query).populate('manager members','name email role').sort('-createdAt').skip((page - 1) * limit).limit(Number(limit)), Project.countDocuments(query)]); res.json({ items, total, page: Number(page), pages: Math.ceil(total / limit) }); });
app.post('/api/projects', auth, roles('admin','manager'), async (req, res) => { const project = await Project.create(req.body); await audit('created','project',req,project.id,project.name); res.status(201).json(project); });
app.patch('/api/projects/:id', auth, roles('admin','manager'), async (req, res) => { const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('manager members','name email role'); if (!project) return res.sendStatus(404); await audit('updated','project',req,project.id,project.name); res.json(project); });
app.delete('/api/projects/:id', auth, roles('admin'), async (req, res) => { await Project.findByIdAndDelete(req.params.id); await Task.deleteMany({ project: req.params.id }); await audit('deleted','project',req,req.params.id); res.sendStatus(204); });

app.get('/api/tasks', auth, async (req, res) => { const { project, status, priority, search = '', page = 1, limit = 20 } = req.query; const query = { ...(project && { project }), ...(status && { status }), ...(priority && { priority }), title: { $regex: search, $options: 'i' } }; const [items,total] = await Promise.all([Task.find(query).populate('project assignee','name title color email').sort({ dueDate: 1 }).skip((page-1)*limit).limit(Number(limit)), Task.countDocuments(query)]); res.json({ items, total, page: Number(page), pages: Math.ceil(total / limit) }); });
app.post('/api/tasks', auth, async (req, res, next) => { try { const payload = { ...req.body }; if (!payload.project) delete payload.project; if (!payload.assignee) delete payload.assignee; const task = await Task.create(payload); await audit('created','task',req,task.id,task.title); res.status(201).json(await task.populate('project assignee','name title color email')); } catch (error) { next(error); } });
app.patch('/api/tasks/:id', auth, async (req, res, next) => { try { const payload = { ...req.body }; if (!payload.project) delete payload.project; if (!payload.assignee) delete payload.assignee; const task = await Task.findByIdAndUpdate(req.params.id, payload, { new: true }).populate('project assignee','name title color email'); if (!task) return res.sendStatus(404); await audit('updated','task',req,task.id,task.title); res.json(task); } catch (error) { next(error); } });
app.delete('/api/tasks/:id', auth, async (req, res) => { await Task.findByIdAndDelete(req.params.id); await audit('deleted','task',req,req.params.id); res.sendStatus(204); });
app.post('/api/tasks/:id/comments', auth, async (req, res) => { const task = await Task.findByIdAndUpdate(req.params.id, { $push: { comments: { author: req.user.name, body: req.body.body } } }, { new: true }); res.json(task); });
app.post('/api/tasks/:id/attachments', auth, upload.single('file'), async (req, res) => { const task = await Task.findByIdAndUpdate(req.params.id, { $push: { attachments: { name: req.file.originalname, path: req.file.path } } }, { new: true }); res.json(task); });
app.get('/api/dashboard', auth, async (_, res) => { const [projects, tasks, completed, upcoming] = await Promise.all([Project.countDocuments(), Task.countDocuments(), Task.countDocuments({ status: 'completed' }), Task.countDocuments({ dueDate: { $gte: new Date(), $lte: new Date(Date.now()+7*86400000) }, status: { $ne: 'completed' } })]); res.json({ projects, tasks, completed, pending: tasks-completed, upcoming }); });
app.get('/api/audit-logs', auth, roles('admin'), async (_, res) => res.json(await Audit.find().sort('-createdAt').limit(100)));
app.use((error, _req, res, _next) => { console.error('API request failed:', error.message); res.status(error.name === 'ValidationError' || error.name === 'CastError' ? 400 : 500).json({ message: error.message || 'Internal server error' }); });
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup({ openapi: '3.0.0', info: { title: 'Orbit Workspace API', version: '1.0.0' }, paths: { '/api/auth/login': { post: { summary: 'Login' } }, '/api/projects': { get: { summary: 'List projects' }, post: { summary: 'Create project' } }, '/api/tasks': { get: { summary: 'List tasks' }, post: { summary: 'Create task' } } } }));

const port = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
	if (!process.env.MONGODB_URI) {
		console.error('MONGODB_URI is missing. Create backend/.env from backend/.env.example.');
		process.exitCode = 1;
	} else {
		mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
			.then(() => app.listen(port, () => console.log(`API listening on http://localhost:${port}`)))
			.catch(error => {
				console.error('MongoDB connection failed:', error.message);
				process.exitCode = 1;
			});
	}
}
export default app;
