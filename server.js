const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const Razorpay = require('razorpay');
require('dotenv').config();

const app = express();

// Middleware
// Replace the existing cors() line with:
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/friendlyvoice', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, required: true },
  registeredAt: { type: Date, default: Date.now },
  bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }]
});

const User = mongoose.model('User', userSchema);

// Booking Schema
const bookingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  paymentId: { type: String, required: true },
  orderId: { type: String },
  amount: { type: Number, required: true },
  duration: { type: Number, required: true },
  status: { type: String, default: 'pending', enum: ['pending', 'completed', 'cancelled'] },
  userName: { type: String, required: true },
  userEmail: { type: String, required: true },
  userPhone: { type: String, required: true },
  scheduledDate: { type: Date },
  bookingDate: { type: Date, default: Date.now }
});

const Booking = mongoose.model('Booking', bookingSchema);

// Email Configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your email
    pass: process.env.EMAIL_PASSWORD // Your app password
  }
});

// Razorpay Configuration
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Admin Credentials
const ADMIN_EMAIL = 'admin@friendlyvoice.com';
const ADMIN_PASSWORD = 'Admin@2025';

// ============== ROUTES ==============

// 1. User Signup
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    // Validation
    if (!name || !email || !password || !phone) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      name,
      email,
      password: hashedPassword,
      phone
    });

    await user.save();

    res.status(201).json({ 
      message: 'Account created successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// 2. User Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check admin login
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      return res.json({ 
        isAdmin: true,
        message: 'Admin login successful'
      });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// 3. Create Razorpay Order
app.post('/api/create-order', async (req, res) => {
  try {
    const { amount } = req.body;

    const options = {
      amount: amount * 100, // Razorpay expects amount in paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);
    res.json({ orderId: order.id, amount: order.amount });
  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// 4. Verify Payment and Create Booking
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { 
      paymentId, 
      orderId, 
      userId, 
      amount, 
      duration,
      userName,
      userEmail,
      userPhone
    } = req.body;

    // Create booking
    const booking = new Booking({
      user: userId,
      paymentId,
      orderId,
      amount,
      duration,
      userName,
      userEmail,
      userPhone,
      status: 'pending'
    });

    await booking.save();

    // Update user's bookings
    await User.findByIdAndUpdate(userId, {
      $push: { bookings: booking._id }
    });

    // Send confirmation email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: userEmail,
      subject: 'Booking Confirmed - Friendly Voice',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ec4899;">✅ Booking Confirmed!</h2>
          <p>Dear ${userName},</p>
          <p>Thank you for booking with Friendly Voice. Your payment has been received successfully.</p>
          
          <div style="background: #f3f4f6; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <h3 style="color: #6b21a8;">Booking Details:</h3>
            <p><strong>Payment ID:</strong> ${paymentId}</p>
            <p><strong>Amount Paid:</strong> ₹${amount}</p>
            <p><strong>Call Duration:</strong> ${duration} minutes</p>
            <p><strong>Phone Number:</strong> ${userPhone}</p>
          </div>

          <p><strong>What's Next?</strong></p>
          <p>We will call you within 24 hours on your registered phone number. Please ensure your phone is reachable.</p>

          <p style="color: #dc2626;"><strong>Important:</strong> If we are unable to reach you due to incorrect contact details, no refund will be provided.</p>

          <p>If you have any questions, reply to this email or contact us at support@friendlyvoice.com</p>

          <p>Warm regards,<br><strong>Friendly Voice Team</strong></p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    // Send notification to admin
    const adminMailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: '🔔 New Booking Received',
      html: `
        <h2>New Booking Alert</h2>
        <p><strong>Name:</strong> ${userName}</p>
        <p><strong>Email:</strong> ${userEmail}</p>
        <p><strong>Phone:</strong> ${userPhone}</p>
        <p><strong>Amount:</strong> ₹${amount}</p>
        <p><strong>Duration:</strong> ${duration} minutes</p>
        <p><strong>Payment ID:</strong> ${paymentId}</p>
        <p><strong>Booking Time:</strong> ${new Date().toLocaleString()}</p>
      `
    };

    await transporter.sendMail(adminMailOptions);

    res.json({ 
      message: 'Booking created successfully',
      bookingId: booking._id 
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// 5. Get All Users (Admin Only)
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .populate('bookings');
    
    res.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// 6. Get All Bookings (Admin Only)
app.get('/api/admin/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('user', 'name email phone')
      .sort({ bookingDate: -1 });
    
    res.json({ bookings });
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// 7. Get User Bookings
app.get('/api/user/:userId/bookings', async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.params.userId })
      .sort({ bookingDate: -1 });
    
    res.json({ bookings });
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// 8. Update Booking Status (Admin Only)
app.put('/api/admin/booking/:bookingId/status', async (req, res) => {
  try {
    const { status } = req.body;
    
    const booking = await Booking.findByIdAndUpdate(
      req.params.bookingId,
      { status },
      { new: true }
    );
    
    res.json({ message: 'Booking status updated', booking });
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// Health Check
app.get('/', (req, res) => {
  res.json({ message: '✅ Friendly Voice API is running' });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});