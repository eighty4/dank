# scale header text based on viewport

# view transition api

animate egg.svg with green filter rotating and scaling
fill screen cheesy comic book style
for page transitions

# recreate egg.svg effect on header text

## using css

.text-inner-and-outer {
  background-color: black;
  color: transparent;
  text-shadow: 0px 2px 3px lightgrey; /* Creates the inner shadow illusion */
  -webkit-background-clip: text;
  background-clip: text;
  filter: drop-shadow(2px 2px 3px rgba(0, 0, 0, 0.5)); /* Adds a true outer shadow */
}

## using svg

Simulating an inner stroke using a clip path
This method involves using a clip path to "hide" the unwanted half of a standard stroke.
Define a clip path: In your <defs> section, create a <clipPath> that contains a <path> element for the letter or text you want to outline.
Apply the stroke: Use a <text> element with a standard stroke. Set the fill to "none" if you want a hollow look.
Clip the text: Apply the clip path to the <text> element using the clip-path attribute. This will mask away the portion of the stroke that falls outside the shape of the text. 
Simulating an outer stroke using paint-order
This approach works by ensuring the stroke is rendered behind the text's fill color, effectively hiding the inner half of the stroke behind the fill.
Set the fill and stroke: Add both fill and stroke attributes to your <text> element. The fill color will hide the inner half of the stroke.
Adjust the stroke-width: Since half of the stroke will be hidden, you must double the stroke-width to achieve your desired visible thickness.
Specify the paint-order: Set the paint-order property to "stroke". This ensures the stroke is drawn first, followed by the fill, which covers the inside of the stroke. 