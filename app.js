const express=require('express');
const app=express();
const cookieParser = require('cookie-parser');
const userModel = require("./modules/User");
const productModel=require('./modules/Product');
const cartModel = require('./modules/Cart');
const orderModel = require('./modules/Order');
const jsonwebtoken=require("jsonwebtoken");
const bcrypt=require('bcrypt');
const path=require('path');
const fs = require('fs');
const multer = require("multer");

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads/"); // folder to save uploaded images
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage });

app.set('view engine','ejs');
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

function verifyToken(req,res,next){
    const token=req.cookies.token;
    if(!token) return res.redirect('/login');

    try{
        const decoded=jsonwebtoken.verify(token,'shhhh');
        req.user=decoded;
        next();
    }catch(err){
        return res.status(401).send('Invalid or Expired token');
    }
}
function requireSeller(req, res, next) {
    if (req.user.role !== "seller" && req.user.role !== "admin") {
        return res.status(403).send("Access denied. Seller access required.");
    }

    next();
}

function requireAdmin(req, res, next) {
    if (req.user.role !== "admin") {
        return res.status(403).send("Access denied. Admin access required.");
    }

    next();
}

app.get('/',(req,res)=>{
    res.render('Home');
})

app.get('/login',(req,res)=>{
    res.render('Login');
})

app.get('/register',(req,res)=>{
    res.render('Register');
})

app.post('/registerForm',async (req,res)=>{
    const {username,email,password,role}=req.body;
    var user=await userModel.findOne({username});
    var mail=await userModel.findOne({email});
    if(user) return res.send('username already exists');
    if(mail) return res.send('E-mail already exists');

    const salt=await bcrypt.genSalt(10);
    const hashedPass=await bcrypt.hash(password,salt);

    var user=await userModel.create({
        username,
        email,
        password:hashedPass,
        role: role === "seller" ? "seller" : "buyer"
    });

    const token=jsonwebtoken.sign({id:user._id,username:user.username, role:user.role},'shhhh');
    
    res.cookie('token', token, {
        httpOnly: true,   // not accessible via JS
        secure: false,    // set true in production (HTTPS only)
        maxAge: 1000 * 60 * 60 * 24  // 1 day
    });


    res.redirect('/profile');
})



app.post('/loginForm',async (req,res)=>{
    const {username,password}=req.body;
    let user=await userModel.findOne({username});
    if(!user) return res.send('User not found!');
    
    const isMatch=await bcrypt.compare(password,user.password);
    if(!isMatch) return res.send('something went wrong');

    const token=jsonwebtoken.sign({id:user._id,username:user.username},'shhhh');
    
    res.cookie('token', token, {
        httpOnly: true,   // not accessible via JS
        secure: false,    // set true in production (HTTPS only)
        maxAge: 1000 * 60 * 60 * 24  // 1 day
    });


    res.redirect('/profile');
})


app.get('/profile', verifyToken, async (req, res) => {
    try {
        const products = await productModel.find({});

        const cart = await cartModel.findOne({
            user: req.user.id
        });

        let cartCount = 0;

        if (cart) {
            cartCount = cart.items.reduce(
                (total, item) => total + item.quantity,
                0
            );
        }

        res.render('FrontPage', {
            user: req.user,
            products,
            cartCount
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

app.get('/sellProducts',verifyToken,requireSeller,async (req,res)=>{
    try {
        // Find all products where owner matches current user's id
        const products = await productModel.find({ owner: req.user.id });
        // Render the sellProducts page and pass the products
        res.render('sellProducts', { products, user: req.user });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
})

app.post('/addProduct',verifyToken,requireSeller,upload.single('image'), async (req, res) => {
    try {
        let imagePath;
        if (req.file) {
            imagePath = req.file.filename; // or req.file.path depending on multer config
        } else if (req.body.existingImage) {
            imagePath = req.body.existingImage.split('/').pop();// keep the old image
        } else {
            throw new Error('Image is required');
        }

        const productData = {
            name: req.body.name,
            description: req.body.description,
            price: req.body.price,
            image: imagePath,
            owner: req.user.id  // ✅ include the owner here
        };

        if (req.body.productId) {
            // update existing product
            await productModel.findByIdAndUpdate(req.body.productId, productData);
        } else {
            // create new product
            await productModel.create(productData);
        }

        res.redirect('/sellProducts');
    } catch (err) {
        console.error(err);
        res.status(400).send(err);
    }
});
app.post('/add-to-cart/:id', verifyToken, async (req, res) => {
    try {
        const productId = req.params.id;
        const userId = req.user.id;

        // Check whether the product exists
        const product = await productModel.findById(productId);

        if (!product) {
            return res.status(404).send("Product not found");
        }

        // Find the logged-in user's cart
        let cart = await cartModel.findOne({ user: userId });

        // If the user does not have a cart, create one
        if (!cart) {
            cart = await cartModel.create({
                user: userId,
                items: [
                    {
                        product: productId,
                        quantity: 1
                    }
                ]
            });
        } else {
            // Check if this product is already in the cart
            const existingItem = cart.items.find(
                item => item.product.toString() === productId
            );

            if (existingItem) {
                // Product already exists → increase quantity
                existingItem.quantity += 1;
            } else {
                // New product → add it to cart
                cart.items.push({
                    product: productId,
                    quantity: 1
                });
            }

            await cart.save();
        }

        // After adding, open the cart
        res.redirect('/cart');

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});
app.delete('/deleteProduct/:id', verifyToken,requireSeller, async (req, res) => {
    try {
        const productId = req.params.id;

        // Ensure that only the owner can delete their product
        const product = await productModel.findOne({ _id: productId, owner: req.user.id });
        if (!product) return res.json({ success: false, message: "Product not found or not authorized" });

        // Delete the image file from uploads folder
        const imagePath = path.join(__dirname, 'uploads', product.image);
        fs.unlink(imagePath, (err) => {
            if (err) {
                console.error("Failed to delete image:", err);
            } else {
                console.log("Image deleted successfully");
            }
        });

        // Delete the product document from MongoDB
        await productModel.findByIdAndDelete(productId);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.json({ success: false, message: "Something went wrong" });
    }
});

app.post('/logout',verifyToken,(req,res)=>{
  res.clearCookie('token');
  res.redirect('/login'); 
})

app.post('/shopNow', verifyToken, async (req, res) => {
  try {
    const products = await productModel.find();
    res.render('shopNow', { user: req.user, products });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

app.get('/product/:id', async (req, res) => {
  try {
    const product = await productModel.findById(req.params.id);
    if (!product) {
      return res.status(404).send("Product not found");
    }
    res.render("productDetails", { product });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


app.get('/cart', verifyToken, async (req, res) => {
    try {
        const cart = await cartModel
            .findOne({ user: req.user.id })
            .populate('items.product');

        res.render('cart', {
            user: req.user,
            cart: cart
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});
app.post('/cart/increase/:id', verifyToken, async (req, res) => {
    try {
        const productId = req.params.id;
        const userId = req.user.id;

        const cart = await cartModel.findOne({ user: userId });

        if (!cart) {
            return res.status(404).send("Cart not found");
        }

        const item = cart.items.find(
            item => item.product.toString() === productId
        );

        if (!item) {
            return res.status(404).send("Product not found in cart");
        }

        item.quantity += 1;

        await cart.save();

        res.redirect('/cart');

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});
app.post('/cart/decrease/:id', verifyToken, async (req, res) => {
    try {
        const productId = req.params.id;
        const userId = req.user.id;

        const cart = await cartModel.findOne({ user: userId });

        if (!cart) {
            return res.status(404).send("Cart not found");
        }

        const itemIndex = cart.items.findIndex(
            item => item.product.toString() === productId
        );

        if (itemIndex === -1) {
            return res.status(404).send("Product not found in cart");
        }

        if (cart.items[itemIndex].quantity > 1) {
            cart.items[itemIndex].quantity -= 1;
        } else {
            // If quantity is already 1, remove the item
            cart.items.splice(itemIndex, 1);
        }

        await cart.save();

        res.redirect('/cart');

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});
app.post('/cart/remove/:id', verifyToken, async (req, res) => {
    try {
        const productId = req.params.id;
        const userId = req.user.id;

        const cart = await cartModel.findOne({ user: userId });

        if (!cart) {
            return res.status(404).send("Cart not found");
        }

        cart.items = cart.items.filter(
            item => item.product.toString() !== productId
        );

        await cart.save();

        res.redirect('/cart');

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});
app.post('/cart/clear', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const cart = await cartModel.findOne({
            user: userId
        });

        if (!cart) {
            return res.redirect('/cart');
        }

        cart.items = [];

        await cart.save();

        res.redirect('/cart');

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});
app.get('/checkout', verifyToken, async (req, res) => {
    try {
        const cart = await cartModel
            .findOne({ user: req.user.id })
            .populate('items.product');

        if (!cart || cart.items.length === 0) {
            return res.redirect('/cart');
        }

        let grandTotal = 0;

        cart.items.forEach(item => {
            grandTotal += item.product.price * item.quantity;
        });

        res.render('checkout', {
            user: req.user,
            cart: cart,
            grandTotal: grandTotal
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});
app.post('/place-order', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { address } = req.body;

        // Validate address
        if (!address || address.trim() === "") {
            return res.status(400).send("Delivery address is required");
        }

        // Find the user's cart
        const cart = await cartModel
            .findOne({ user: userId })
            .populate('items.product');

        // Check whether cart exists and has items
        if (!cart || cart.items.length === 0) {
            return res.status(400).send("Your cart is empty");
        }

        // Prepare order items
        const orderItems = cart.items.map(item => ({
            product: item.product._id,
            quantity: item.quantity,
            price: item.product.price
        }));

        // Calculate total
        let totalAmount = 0;

        cart.items.forEach(item => {
            totalAmount += item.product.price * item.quantity;
        });

        // Create order
        const order = await orderModel.create({
            user: userId,
            items: orderItems,
            totalAmount: totalAmount,
            address: address.trim(),
            status: "Processing"
        });

        // Clear cart after successful order creation
        cart.items = [];
        await cart.save();

        // Show confirmation
        // res.send(`
        //     <h1>Order Placed Successfully!</h1>
        //     <p>Your Order ID: ${order._id}</p>
        //     <p>Total Amount: $${order.totalAmount}</p>
        //     <p>Status: ${order.status}</p>
        //     <a href="/profile">Back to Home</a>
        // `);
        res.render('orderSuccess', {
    user: req.user,
    order: order
});

    } catch (err) {
        console.error(err);
        res.status(500).send("Failed to place order");
    }
});
app.get('/orders', verifyToken, async (req, res) => {
    try {
        const orders = await orderModel
            .find({ user: req.user.id })
            .populate('items.product')
            .sort({ createdAt: -1 });

        res.render('orders', {
            user: req.user,
            orders: orders
        });

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});
app.listen(3000); 